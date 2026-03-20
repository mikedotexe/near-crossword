import React from "react";

const Loader = () => {
  return (
    <div className="loading-overlay" role="status" aria-live="polite">
      <div className="loading-spinner" />
      <p>Sending transaction...</p>
    </div>
  );
};

export default Loader;
