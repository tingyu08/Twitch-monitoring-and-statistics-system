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
      mockHttpClient.mockResolvedValueOnce(mockResponse);

      const result = await logout();

      expect(mockHttpClient).toHaveBeenCalledWith('/api/auth/logout', {
        method: 'POST',
      });
      expect(result).toEqual(mockResponse);
    });

    it('should propagate errors from httpClient', async () => {
      const error = new Error('Logout failed');
      mockHttpClient.mockRejectedValueOnce(error);

      await expect(logout()).rejects.toThrow('Logout failed');
    });
  });
});