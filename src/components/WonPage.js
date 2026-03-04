import React, { useState } from "react";

const WonPage = ({
  claimStatusClasses,
  claimError,
  needsNewAccount,
  setNeedsNewAccount,
  claimPrize,
  playerKeyPair,
  nearConfig,
}) => {
  const [inputMemo, setInputMemo] = useState("");
  const [inputName, setInputName] = useState("");
  const isButtonDisabled = !inputMemo || !inputName;

  return (
    <section className="card claim-card">
      <p className="eyebrow">Congratulations!</p>
      <h2>You solved it! Claim your reward.</h2>
      <p>
        Add your memo and destination account. If needed, you can create a new
        account with your generated seed phrase.
      </p>

      <form className="crossword-form" onSubmit={claimPrize}>
        <div id="claim-status" className={claimStatusClasses}>
          <p>{claimError}</p>
        </div>

        <div className="field-group">
          <label htmlFor="claim-memo">Winning memo</label>
          <input
            type="text"
            id="claim-memo"
            name="claim-memo"
            value={inputMemo}
            onChange={(event) => setInputMemo(event.target.value)}
            placeholder="Enter your winning memo"
          />
        </div>

        <div className="field-group radio-group">
          <label className="radio-option" htmlFor="claim-existing-account">
            <input
              id="claim-existing-account"
              name="claim-account-mode"
              type="radio"
              checked={!needsNewAccount}
              onChange={() => setNeedsNewAccount(false)}
            />
            <span>I have an account</span>
          </label>

          <label className="radio-option" htmlFor="claim-new-account">
            <input
              id="claim-new-account"
              name="claim-account-mode"
              type="radio"
              checked={needsNewAccount}
              onChange={() => setNeedsNewAccount(true)}
            />
            <span>I need to create an account</span>
          </label>
        </div>

        {needsNewAccount ? (
          <div id="seed-phrase-wrapper" className="field-group seed-phrase-card">
            <h3>Save this seed phrase before continuing</h3>
            <p id="seed-phrase">{playerKeyPair.seedPhrase}</p>
            <p>
              After successful claim, import it into{" "}
              <a href={nearConfig.walletUrl} rel="noreferrer" target="_blank">
                NEAR Wallet
              </a>
              .
            </p>
          </div>
        ) : null}

        <div className="field-group">
          <label htmlFor="claim-account-id">Destination account</label>
          <input
            type="text"
            id="claim-account-id"
            name="claim-account-id"
            placeholder="e.g. yourname.near"
            value={inputName}
            onChange={(event) => setInputName(event.target.value)}
          />
        </div>

        <button
          type="submit"
          className="button button-primary"
          disabled={isButtonDisabled}
        >
          Submit Claim
        </button>
      </form>
    </section>
  );
};

export default WonPage;
