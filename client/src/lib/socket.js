import { io } from 'socket.io-client';

// In dev, Vite proxies /socket.io → localhost:3001
// In prod, same origin serves everything
export const socket = io({
  autoConnect: false,
  withCredentials: true,
});
