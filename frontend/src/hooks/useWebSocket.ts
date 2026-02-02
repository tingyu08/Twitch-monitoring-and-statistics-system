/**
 * useWebSocket Hook
 * WebSocket connection management with exponential backoff reconnection
 *
 * Reconnection strategy:
 * - Initial delay: 1s
 * - Max delay: 30s
 * - Backoff multiplier: 2x
 * - Pattern: 1s → 2s → 4s → 8s → 16s → 30s → 30s...
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { io, Socket } from "socket.io-client";

const SOCKET_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

// Reconnection constants
const INITIAL_DELAY_MS = 1000; // 1 second
const MAX_DELAY_MS = 30000; // 30 seconds
const BACKOFF_MULTIPLIER = 2;

export interface WebSocketOptions {
  /** Enable/disable auto-connect on mount */
  autoConnect?: boolean;
  /** Called when connected */
  onConnect?: (socket: Socket) => void;
  /** Called when disconnected */
  onDisconnect?: (reason: string) => void;
  /** Called on connection error */
  onError?: (error: Error) => void;
  /** Called when reconnecting (with attempt number and delay) */
  onReconnecting?: (attempt: number, delayMs: number) => void;
  /** Called when max retries exhausted (optional limit) */
  onMaxRetriesReached?: () => void;
  /** Maximum reconnection attempts (undefined = infinite) */
  maxRetries?: number;
}

export interface WebSocketState {
  socket: Socket | null;
  connected: boolean;
  connecting: boolean;
  reconnectAttempt: number;
  nextReconnectDelay: number;
}

export interface WebSocketActions {
  connect: () => void;
  disconnect: () => void;
  resetReconnect: () => void;
}

export function useWebSocket(options: WebSocketOptions = {}): WebSocketState & WebSocketActions {
  const {
    autoConnect = true,
    onConnect,
    onDisconnect,
    onError,
    onReconnecting,
    onMaxRetriesReached,
    maxRetries,
  } = options;

  const [state, setState] = useState<WebSocketState>({
    socket: null,
    connected: false,
    connecting: false,
    reconnectAttempt: 0,
    nextReconnectDelay: INITIAL_DELAY_MS,
  });

  const socketRef = useRef<Socket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptRef = useRef(0);
  const currentDelayRef = useRef(INITIAL_DELAY_MS);
  const isManualDisconnectRef = useRef(false);
  const isMountedRef = useRef(true);
  const isInitializedRef = useRef(false);
  const scheduleReconnectRef = useRef<(() => void) | null>(null);

  // Store callbacks in refs to avoid dependency issues
  const onConnectRef = useRef(onConnect);
  const onDisconnectRef = useRef(onDisconnect);
  const onErrorRef = useRef(onError);
  const onReconnectingRef = useRef(onReconnecting);
  const onMaxRetriesReachedRef = useRef(onMaxRetriesReached);
  const maxRetriesRef = useRef(maxRetries);

  // Update refs when callbacks change
  useEffect(() => {
    onConnectRef.current = onConnect;
  }, [onConnect]);

  useEffect(() => {
    onDisconnectRef.current = onDisconnect;
  }, [onDisconnect]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    onReconnectingRef.current = onReconnecting;
  }, [onReconnecting]);

  useEffect(() => {
    onMaxRetriesReachedRef.current = onMaxRetriesReached;
  }, [onMaxRetriesReached]);

  useEffect(() => {
    maxRetriesRef.current = maxRetries;
  }, [maxRetries]);

  /**
   * Reset reconnection state
   * Note: Using refs for all external values to avoid dependency issues
   */
  const resetReconnect = useCallback(() => {
    // Clear timeout inline to avoid dependency
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    reconnectAttemptRef.current = 0;
    currentDelayRef.current = INITIAL_DELAY_MS;
    if (isMountedRef.current) {
      setState((prev) => ({
        ...prev,
        reconnectAttempt: 0,
        nextReconnectDelay: INITIAL_DELAY_MS,
      }));
    }
  }, []); // No dependencies - all values come from refs

  /**
   * Schedule reconnection with exponential backoff
   * Note: Using refs for all external values to avoid dependency issues
   */
  const scheduleReconnect = useCallback(() => {
    if (isManualDisconnectRef.current) {
      return;
    }

    // Check max retries
    if (maxRetriesRef.current !== undefined && reconnectAttemptRef.current >= maxRetriesRef.current) {
      console.log(`[WebSocket] Max retries (${maxRetriesRef.current}) reached, stopping reconnection`);
      onMaxRetriesReachedRef.current?.();
      return;
    }

    const delay = currentDelayRef.current;
    const attempt = reconnectAttemptRef.current + 1;

    console.log(`[WebSocket] Scheduling reconnect attempt ${attempt} in ${delay}ms`);
    onReconnectingRef.current?.(attempt, delay);

    if (isMountedRef.current) {
      setState((prev) => ({
        ...prev,
        reconnectAttempt: attempt,
        nextReconnectDelay: delay,
        connecting: true,
      }));
    }

    reconnectTimeoutRef.current = setTimeout(() => {
      if (!isMountedRef.current || isManualDisconnectRef.current) {
        return;
      }

      reconnectAttemptRef.current = attempt;
      // Calculate next delay inline to avoid dependency
      currentDelayRef.current = Math.min(delay * BACKOFF_MULTIPLIER, MAX_DELAY_MS);

      // Attempt to reconnect
      if (socketRef.current) {
        console.log(`[WebSocket] Attempting reconnect (attempt ${attempt})`);
        socketRef.current.connect();
      }
    }, delay);
  }, []); // No dependencies - all values come from refs

  // Store scheduleReconnect in ref so createSocket can use it without dependency
  scheduleReconnectRef.current = scheduleReconnect;

  /**
   * Create and configure socket
   * Note: Using refs for all external values to avoid dependency issues
   */
  const createSocket = useCallback(() => {
    if (typeof window === "undefined") return null;

    console.log("[WebSocket] Creating new socket connection");

    const socket = io(SOCKET_URL, {
      withCredentials: true,
      transports: ["websocket", "polling"],
      path: "/socket.io",
      // Disable built-in reconnection - we handle it ourselves
      reconnection: false,
      // Connection timeout
      timeout: 10000,
    });

    // Connection established
    socket.on("connect", () => {
      console.log("[WebSocket] Connected:", socket.id);
      const transport = socket.io.engine.transport.name;
      console.log("[WebSocket] Transport:", transport);

      // Reset reconnection state on successful connect - inline to avoid dependency
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      reconnectAttemptRef.current = 0;
      currentDelayRef.current = INITIAL_DELAY_MS;
      isManualDisconnectRef.current = false;

      if (isMountedRef.current) {
        setState((prev) => ({
          ...prev,
          socket,
          connected: true,
          connecting: false,
          reconnectAttempt: 0,
          nextReconnectDelay: INITIAL_DELAY_MS,
        }));
      }

      onConnectRef.current?.(socket);

      // Log transport upgrade
      socket.io.engine.on("upgrade", (transport) => {
        console.log("[WebSocket] Transport upgraded to:", transport.name);
      });
    });

    // Disconnection
    socket.on("disconnect", (reason) => {
      console.log("[WebSocket] Disconnected:", reason);

      if (isMountedRef.current) {
        setState((prev) => ({
          ...prev,
          connected: false,
          connecting: false,
        }));
      }

      onDisconnectRef.current?.(reason);

      // Only schedule reconnect if not manually disconnected
      if (!isManualDisconnectRef.current) {
        // Server disconnect requires manual reconnect
        if (reason === "io server disconnect") {
          // Use scheduleReconnect via ref to avoid dependency
          scheduleReconnectRef.current?.();
        } else if (reason === "transport close" || reason === "transport error") {
          // Transport issues - reconnect with backoff
          scheduleReconnectRef.current?.();
        }
        // "io client disconnect" = manual disconnect, don't reconnect
      }
    });

    // Connection error
    socket.on("connect_error", (error) => {
      console.error("[WebSocket] Connection error:", error.message);

      if (isMountedRef.current) {
        setState((prev) => ({
          ...prev,
          connected: false,
          connecting: false,
        }));
      }

      onErrorRef.current?.(error);

      // Schedule reconnect on connection error
      if (!isManualDisconnectRef.current) {
        scheduleReconnectRef.current?.();
      }
    });

    return socket;
  }, []); // No dependencies - all values come from refs

  /**
   * Connect to WebSocket
   * Note: Using refs for all external values to avoid dependency issues
   */
  const connect = useCallback(() => {
    // Clean up existing socket
    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
    }

    // Clear timeout inline to avoid dependency
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    isManualDisconnectRef.current = false;

    setState((prev) => ({
      ...prev,
      connecting: true,
    }));

    const socket = createSocket();
    if (socket) {
      socketRef.current = socket;
      setState((prev) => ({
        ...prev,
        socket,
      }));
    }
  }, [createSocket]);

  /**
   * Disconnect from WebSocket
   * Note: Using refs for all external values to avoid dependency issues
   */
  const disconnect = useCallback(() => {
    console.log("[WebSocket] Manual disconnect requested");
    isManualDisconnectRef.current = true;
    
    // Clear timeout and reset inline to avoid dependencies
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    reconnectAttemptRef.current = 0;
    currentDelayRef.current = INITIAL_DELAY_MS;

    if (socketRef.current) {
      socketRef.current.disconnect();
    }

    setState((prev) => ({
      ...prev,
      connected: false,
      connecting: false,
      reconnectAttempt: 0,
      nextReconnectDelay: INITIAL_DELAY_MS,
    }));
  }, []); // No dependencies - all values come from refs

  // Auto-connect on mount if enabled - only run once
  useEffect(() => {
    isMountedRef.current = true;

    // Only initialize once
    if (!isInitializedRef.current && autoConnect) {
      isInitializedRef.current = true;
      connect();
    }

    return () => {
      isMountedRef.current = false;
      // Clear timeout inline
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
    // Only depend on autoConnect for the initial setup
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConnect]);

  return {
    ...state,
    connect,
    disconnect,
    resetReconnect,
  };
}

export default useWebSocket;
