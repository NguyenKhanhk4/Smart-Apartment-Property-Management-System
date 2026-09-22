import { createContext } from 'react';

// Tách riêng khỏi AuthProvider.jsx để file .jsx chỉ export component (yêu cầu của Fast Refresh).
export const AuthContext = createContext(null);
