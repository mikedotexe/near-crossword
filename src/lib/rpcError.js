const UNKNOWN_ACCOUNT_PATTERN =
  /UNKNOWN_ACCOUNT|does not exist while viewing|requested account does not exist/i;
const METHOD_MISSING_PATTERN =
  /MethodNotFound|does not exist in contract|Cannot find method|unknown method|FunctionCallError\(MethodResolveError/i;

const toMessage = (value) => {
  if (typeof value === "string") {
    return value;
  }
  if (!value) {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return String(value);
  }
};

const classifyRpcError = ({ rpcName, rpcData, message, rawRpcError }) => {
  const searchable = `${rpcName || ""} ${rpcData || ""} ${message || ""} ${
    rawRpcError || ""
  }`;
  return {
    isUnknownAccount: UNKNOWN_ACCOUNT_PATTERN.test(searchable),
    isMethodMissing: METHOD_MISSING_PATTERN.test(searchable),
  };
};

const resolveMessage = ({ explicitMessage, rpcName, rpcData, rawMessage }) => {
  if (explicitMessage && explicitMessage !== "Server error") {
    return explicitMessage;
  }

  const detail = rpcData || rawMessage || "";
  const header = rpcName || "NEAR RPC error";
  if (detail) {
    return `${header}: ${detail}`;
  }

  if (explicitMessage) {
    return explicitMessage;
  }

  return "NEAR RPC request failed";
};

export const createRpcError = ({
  message,
  rpcError,
  isNetworkFailure = false,
  context = {},
  cause,
}) => {
  const rpcName =
    rpcError?.cause?.name || rpcError?.name || rpcError?.cause?.cause?.name || "";
  const rpcData = toMessage(
    rpcError?.data ||
      rpcError?.cause?.info ||
      rpcError?.cause?.cause?.info ||
      rpcError?.cause
  );
  const rawMessage = toMessage(rpcError?.message);
  const rawRpcError = toMessage(rpcError);
  const resolvedMessage = resolveMessage({
    explicitMessage: message,
    rpcName,
    rpcData,
    rawMessage,
  });
  const flags = classifyRpcError({
    rpcName,
    rpcData,
    message: resolvedMessage,
    rawRpcError,
  });

  const error = new Error(resolvedMessage);
  error.rpcName = rpcName;
  error.rpcData = rpcData;
  error.rpcError = rpcError || null;
  error.isUnknownAccount = flags.isUnknownAccount;
  error.isMethodMissing = flags.isMethodMissing;
  error.isNetworkFailure = isNetworkFailure;
  error.context = context;
  if (cause) {
    error.cause = cause;
  }
  return error;
};
