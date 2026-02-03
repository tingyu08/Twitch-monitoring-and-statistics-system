import { getMe, logout } from '../auth';
import { httpClient } from '../httpClient';

// Mock httpClient
jest.mock('../httpClient');
const mockHttpClient = httpClient as jest.MockedFunction<typeof httpClient>;

describe('auth.ts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getMe', () => {
    it('should call httpClient with correct endpoint', async () => {
      const mockUser = {
        role: 'streamer',
        streamerId: '123',
        twitchUserId: 'tw123',
        displayName: 'TestUser',
        avatarUrl: 'https://example.com/avatar.jpg',
        channelUrl: 'https://twitch.tv/testuser',
      };

      mockHttpClient.mockResolvedValueOnce(mockUser);

      const result = await getMe();

      expect(mockHttpClient).toHaveBeenCalledWith('/api/auth/me');
      expect(result).toEqual(mockUser);
    });

    it('should propagate errors from httpClient', async () => {
      const error = new Error('Network error');
      mockHttpClient.mockRejectedValueOnce(error);

      await expect(getMe()).rejects.toThrow('Network error');
    });
  });

  describe('logout', () => {
    it('should call httpClient with correct endpoint and method', async () => {
      const mockResponse = { message: 'Logged out successfully' };
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      } as Response);

      const result = await logout();

      expect(global.fetch).toHaveBeenCalledWith('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      expect(result).toEqual(mockResponse);
    });

    it('should propagate errors from httpClient', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      await expect(logout()).rejects.toThrow('Request failed with status 500');
    });
  });
});
