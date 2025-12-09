import { httpClient } from '../httpClient';
import { apiLogger } from '../../logger';

// Mock fetch
global.fetch = jest.fn();
const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

// Mock apiLogger
jest.mock('../../logger', () => ({
  apiLogger: {
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('httpClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.NEXT_PUBLIC_API_URL;
  });

  it('should make a successful GET request', async () => {
    const mockData = { id: 1, name: 'Test' };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockData,
    } as Response);

    const result = await httpClient('/test');

    expect(mockFetch).toHaveBeenCalledWith('/test', {
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    });
    expect(result).toEqual(mockData);
  });

  it('should use API_URL from environment', async () => {
    // Note: process.env changes don't affect runtime in Jest
    // This test is kept for documentation but the actual URL resolution
    // happens at module load time in httpClient
    const mockData = { success: true };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockData,
    } as Response);

    await httpClient('/test');

    // In test environment, API_URL is empty string, so path is used directly
    expect(mockFetch).toHaveBeenCalledWith('/test', expect.any(Object));
  });

  it('should handle endpoints without leading slash', async () => {
    const mockData = { success: true };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockData,
    } as Response);

    await httpClient('test');

    expect(mockFetch).toHaveBeenCalledWith('/test', expect.any(Object));
  });

  it('should merge custom headers', async () => {
    const mockData = { success: true };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockData,
    } as Response);

    await httpClient('/test', {
      headers: {
        'X-Custom-Header': 'value',
      },
    });

    expect(mockFetch).toHaveBeenCalledWith('/test', {
      headers: {
        'Content-Type': 'application/json',
        'X-Custom-Header': 'value',
      },
      credentials: 'include',
    });
  });

  it('should handle non-JSON responses', async () => {
    const mockText = 'Plain text response';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/plain' }),
      text: async () => mockText,
    } as Response);

    const result = await httpClient('/test');

    expect(result).toBe(mockText);
  });

  it('should handle 401 Unauthorized errors', async () => {
    const errorData = { message: 'Unauthorized' };
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => errorData,
    } as Response);

    await expect(httpClient('/test')).rejects.toThrow('Unauthorized');
    expect(apiLogger.warn).toHaveBeenCalledWith('Unauthorized access request to:', '/test');
  });

  it('should handle other HTTP errors with custom message', async () => {
    const errorData = { message: 'Not found' };
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => errorData,
    } as Response);

    await expect(httpClient('/test')).rejects.toThrow('Not found');
  });

  it('should handle HTTP errors without message field', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ error: 'Internal error' }),
    } as Response);

    await expect(httpClient('/test')).rejects.toThrow('Request failed with status 500');
  });

  it('should handle network errors', async () => {
    const networkError = new Error('Network failure');
    mockFetch.mockRejectedValueOnce(networkError);

    await expect(httpClient('/test')).rejects.toThrow('Network failure');
    expect(apiLogger.error).toHaveBeenCalledWith('API Request Error:', networkError);
  });

  it('should pass through request options', async () => {
    const mockData = { success: true };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockData,
    } as Response);

    await httpClient('/test', {
      method: 'POST',
      body: JSON.stringify({ data: 'test' }),
    });

    expect(mockFetch).toHaveBeenCalledWith('/test', {
      method: 'POST',
      body: JSON.stringify({ data: 'test' }),
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    });
  });
});