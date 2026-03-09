const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

export const getTransactionStatus = (transaction) => {
  if (!transaction || typeof transaction !== "object") {
    return null;
  }

  if (transaction.status && typeof transaction.status === "object") {
    return transaction.status;
  }

  if (transaction.result?.status && typeof transaction.result.status === "object") {
    return transaction.result.status;
  }

  return null;
};

export const getTransactionSuccessValue = (transaction) => {
  const status = getTransactionStatus(transaction);
  if (!status || !hasOwn(status, "SuccessValue")) {
    return null;
  }
  return status.SuccessValue;
};

export const getTransactionFailure = (transaction) => {
  const status = getTransactionStatus(transaction);
  if (!status || !hasOwn(status, "Failure")) {
    return null;
  }
  return status.Failure;
};

export const getTransactionHash = (transaction) =>
  transaction?.transaction?.hash || transaction?.result?.transaction?.hash || null;
