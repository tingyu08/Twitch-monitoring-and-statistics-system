import { logger, apiLogger, authLogger, chartLogger, Logger } from '../logger';

describe('Logger', () => {
  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  beforeEach(() => {
    console.log = jest.fn();
    console.info = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();
  });

  afterEach(() => {
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  });

  describe('basic functions', () => {
    it('should output debug in non-production', () => {
      const originalEnv = process.env.NODE_ENV;
      (process.env as any).NODE_ENV = 'development';
      
      logger.debug('test message', { data: 'test' });
      
      expect(console.log).toHaveBeenCalledWith('[App] test message', { data: 'test' });
      
      (process.env as any).NODE_ENV = originalEnv;
    });

    it('should always output info', () => {
      logger.info('info message', { level: 'info' });
      expect(console.info).toHaveBeenCalledWith('[App] info message', { level: 'info' });
    });

    it('should always output warn', () => {
      logger.warn('warning message', { severity: 'medium' });
      expect(console.warn).toHaveBeenCalledWith('[App] warning message', { severity: 'medium' });
    });

    it('should always output error', () => {
      logger.error('error message', { code: 500 });
      expect(console.error).toHaveBeenCalledWith('[App] error message', { code: 500 });
    });
  });

  describe('prefix functionality', () => {
    it('apiLogger should use API prefix', () => {
      apiLogger.info('API request');
      expect(console.info).toHaveBeenCalledWith('[API] API request');
    });

    it('authLogger should use Auth prefix', () => {
      authLogger.warn('auth failed');
      expect(console.warn).toHaveBeenCalledWith('[Auth] auth failed');
    });

    it('chartLogger should use Chart prefix', () => {
      chartLogger.error('chart load failed');
      expect(console.error).toHaveBeenCalledWith('[Chart] chart load failed');
    });
  });

  describe('multiple parameters support', () => {
    it('should support multiple params', () => {
      logger.info('message', 'arg1', { key: 'value' }, [1, 2, 3]);
      
      expect(console.info).toHaveBeenCalledWith(
        '[App] message',
        'arg1',
        { key: 'value' },
        [1, 2, 3]
      );
    });

    it('should support no additional params', () => {
      logger.error('simple error');
      expect(console.error).toHaveBeenCalledWith('[App] simple error');
    });
  });

  describe('production environment', () => {
    it('info/warn/error should still output in production', () => {
      const originalEnv = process.env.NODE_ENV;
      (process.env as any).NODE_ENV = 'production';
      
      logger.info('info');
      logger.warn('warning');
      logger.error('error');
      
      expect(console.info).toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalled();
      expect(console.error).toHaveBeenCalled();
      
      (process.env as any).NODE_ENV = originalEnv;
    });
  });

  describe('Logger.create static method', () => {
    it('should create Logger with custom prefix', () => {
      const customLogger = Logger.create('Custom');
      
      customLogger.info('custom message');
      
      expect(console.info).toHaveBeenCalledWith('[Custom] custom message');
    });
  });
});
