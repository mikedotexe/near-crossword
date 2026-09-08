"use client";

import {
  CDPHooksProvider,
  useCurrentUser,
  useGetAccessToken,
  useIsInitialized,
  useIsSignedIn,
  useSendUserOperation,
  useSignEvmTypedData,
  useSignInWithEmail,
  useSignOut,
  useVerifyEmailOTP,
} from "@coinbase/cdp-hooks";
import type {
  SendUserOperationOptions,
  SendUserOperationResult,
  User,
} from "@coinbase/cdp-core";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getAddress, type Address, type Hex } from "viem";
import { signSmartWalletMessage } from "../../src/lib/base/wallet-proof";

type SessionState = "disabled" | "initializing" | "signed-out" | "syncing" | "ready" | "error";

type ParticipantAccountValue = {
  enabled: boolean;
  state: SessionState;
  email: string | null;
  recipient: Address | null;
  sessionVersion: number;
  error: string;
  requestEmailCode(email: string): Promise<string>;
  verifyEmailCode(flowId: string, otp: string): Promise<void>;
  signMessage(message: string): Promise<Hex>;
  sendUserOperation(
    options: SendUserOperationOptions,
  ): Promise<SendUserOperationResult>;
  signOut(): Promise<void>;
};

const unavailable = async (): Promise<never> => {
  throw new Error("Coinbase participant accounts are not enabled");
};
const disabledValue: ParticipantAccountValue = {
  enabled: false,
  state: "disabled",
  email: null,
  recipient: null,
  sessionVersion: 0,
  error: "",
  requestEmailCode: unavailable,
  verifyEmailCode: unavailable,
  signMessage: unavailable,
  sendUserOperation: unavailable,
  signOut: unavailable,
};
const ParticipantAccountContext =
  createContext<ParticipantAccountValue>(disabledValue);

function smartAccount(user: User | null): {
  recipient: Address;
  owner: Address;
} | null {
  const account = user?.evmSmartAccountObjects?.[0];
  const rawOwner = account?.ownerAddresses?.[0];
  if (!account?.address || account.ownerAddresses.length !== 1 || !rawOwner)
    return null;
  try {
    const recipient = getAddress(account.address).toLowerCase() as Address;
    const owner = getAddress(rawOwner).toLowerCase() as Address;
    const controlsOwner = user?.evmAccountObjects?.some(
      (candidate) => candidate.address.toLowerCase() === owner,
    );
    return controlsOwner ? { recipient, owner } : null;
  } catch {
    return null;
  }
}

function CdpParticipantBridge({
  chainId,
  factory,
  children,
}: {
  chainId: number;
  factory: Address;
  children: ReactNode;
}) {
  const { currentUser } = useCurrentUser();
  const { isInitialized } = useIsInitialized();
  const { isSignedIn } = useIsSignedIn();
  const { getAccessToken } = useGetAccessToken();
  const { signInWithEmail } = useSignInWithEmail();
  const { verifyEmailOTP } = useVerifyEmailOTP();
  const { signEvmTypedData } = useSignEvmTypedData();
  const { sendUserOperation } = useSendUserOperation();
  const { signOut } = useSignOut();
  const [state, setState] = useState<SessionState>("initializing");
  const [error, setError] = useState("");
  const [sessionVersion, setSessionVersion] = useState(0);
  const [expiresAt, setExpiresAt] = useState(0);
  const inFlight = useRef<Promise<void> | null>(null);
  const account = smartAccount(currentUser);
  const recipient = account?.recipient ?? null;
  const owner = account?.owner ?? null;
  const email = currentUser?.authenticationMethods.email?.email ?? null;

  const syncSession = useCallback(
    async (user: User) => {
      if (inFlight.current) return inFlight.current;
      const run = (async () => {
        const participant = smartAccount(user);
        if (!participant) {
          throw new Error("Coinbase did not create a smart account");
        }
        setState("syncing");
        setError("");
        const accessToken = await getAccessToken();
        if (!accessToken) throw new Error("Coinbase session is unavailable");
        const response = await fetch("/api/base/auth/session", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          body: JSON.stringify({ accessToken, recipient: participant.recipient }),
        });
        const body = await response.json();
        if (!response.ok) {
          throw new Error(
            body?.error?.message || "Coinbase sign-in could not be completed",
          );
        }
        setExpiresAt(new Date(body.expiresAt).getTime());
        setState("ready");
        setSessionVersion((version) => version + 1);
      })();
      inFlight.current = run;
      try {
        await run;
      } catch (cause) {
        setState("error");
        setError(
          cause instanceof Error
            ? cause.message
            : "Coinbase sign-in could not be completed",
        );
        throw cause;
      } finally {
        inFlight.current = null;
      }
    },
    [getAccessToken],
  );

  useEffect(() => {
    if (!isInitialized) {
      setState("initializing");
      return;
    }
    if (!isSignedIn || !currentUser) {
      setState("signed-out");
      setExpiresAt(0);
      return;
    }
    // CDP publishes the authenticated user before createOnLogin finishes.
    // Treat that intermediate state as pending instead of a failed account.
    if (!recipient) {
      setState("initializing");
      return;
    }
    if (state === "initializing" || state === "signed-out") {
      void syncSession(currentUser).catch(() => undefined);
    }
  }, [currentUser, isInitialized, isSignedIn, recipient, state, syncSession]);

  useEffect(() => {
    if (state !== "ready" || !currentUser || !expiresAt) return;
    const delay = Math.max(1_000, expiresAt - Date.now() - 120_000);
    const timer = setTimeout(() => {
      setState("syncing");
      void syncSession(currentUser).catch(() => undefined);
    }, delay);
    return () => clearTimeout(timer);
  }, [currentUser, expiresAt, state, syncSession]);

  const value = useMemo<ParticipantAccountValue>(
    () => ({
      enabled: true,
      state,
      email,
      recipient,
      sessionVersion,
      error,
      async requestEmailCode(nextEmail) {
        setError("");
        const result = await signInWithEmail({
          email: nextEmail.trim().toLowerCase(),
        });
        return result.flowId;
      },
      async verifyEmailCode(flowId, otp) {
        setError("");
        const result = await verifyEmailOTP({ flowId, otp: otp.trim() });
        await syncSession(result.user);
      },
      async signMessage(message) {
        if (!recipient || state !== "ready") {
          throw new Error("Finish Coinbase sign-in before verifying the reward");
        }
        if (!recipient || !owner) {
          throw new Error("Coinbase account ownership is unavailable");
        }
        const signature = await signSmartWalletMessage({
          message,
          chainId,
          smartAccount: recipient,
          owner,
          factory,
          signTypedData: async (typedData) =>
            (
              await signEvmTypedData({
                evmAccount: owner,
                typedData,
              })
            ).signature,
        });
        if (
          !/^0x(?:[0-9a-fA-F]{2})+$/.test(signature) ||
          signature.length > 8194
        ) {
          throw new Error("Coinbase returned an unsupported wallet proof");
        }
        return signature;
      },
      sendUserOperation,
      async signOut() {
        await fetch("/api/base/auth/session", {
          method: "DELETE",
          credentials: "same-origin",
          cache: "no-store",
          headers: { accept: "application/json" },
        }).catch(() => undefined);
        await signOut();
        setState("signed-out");
        setExpiresAt(0);
      },
    }),
    [
      email,
      error,
      factory,
      chainId,
      owner,
      recipient,
      sendUserOperation,
      sessionVersion,
      signEvmTypedData,
      signInWithEmail,
      signOut,
      state,
      syncSession,
      verifyEmailOTP,
    ],
  );
  return (
    <ParticipantAccountContext.Provider value={value}>
      {children}
    </ParticipantAccountContext.Provider>
  );
}

export function ParticipantAccountProvider({
  projectId,
  chainId,
  factory,
  children,
}: {
  projectId: string | null;
  chainId: number | null;
  factory: string | null;
  children: ReactNode;
}) {
  let checkedFactory: Address | null = null;
  try {
    checkedFactory = factory ? getAddress(factory) : null;
  } catch {
    checkedFactory = null;
  }
  if (!projectId || !chainId || !checkedFactory) {
    return (
      <ParticipantAccountContext.Provider value={disabledValue}>
        {children}
      </ParticipantAccountContext.Provider>
    );
  }
  return (
    <CDPHooksProvider
      config={{
        projectId,
        ethereum: { createOnLogin: "smart", enableSpendPermissions: false },
        disableAnalytics: true,
      }}
    >
      <CdpParticipantBridge chainId={chainId} factory={checkedFactory}>
        {children}
      </CdpParticipantBridge>
    </CDPHooksProvider>
  );
}

export function useParticipantAccount() {
  return useContext(ParticipantAccountContext);
}
