import { createContext, useContext } from 'react';

export type AccountStatus = {available:boolean;signed_in:boolean;expires_at:number|null};
export type Account = {signedIn:boolean;signOut:()=>void;signIn:()=>void};

export const AccountContext = createContext<Account|null>(null);
export const useAccount = () => useContext(AccountContext);
