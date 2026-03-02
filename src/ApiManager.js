import getConfig from "./config";
import * as near from "@fastnear/api";
import * as nearWallet from "@fastnear/wallet";
import fastnearWalletManifest from "./fastnearWalletManifest";

class ApiManager {
  constructor() {
    this.restorePromise = Promise.resolve(null);
  }

  async setUp() {
    this.nearConfig = getConfig(
      process.env.NEXT_PUBLIC_NEAR_ENV || "testnet"
    );

    if (
      this.nearConfig.networkId !== "mainnet" &&
      this.nearConfig.networkId !== "testnet"
    ) {
      throw new Error(
        `FastNear wallet login only supports mainnet/testnet. Current network is "${this.nearConfig.networkId}".`
      );
    }

    near.config({
      networkId: this.nearConfig.networkId,
      nodeUrl: this.nearConfig.nodeUrl,
    });
    near.useWallet(nearWallet);

    this.walletOptions = {
      network: this.nearConfig.networkId,
      contractId: this.nearConfig.contractName,
      methodNames: ["new_puzzle"],
      manifest: fastnearWalletManifest,
      walletConnect: { projectId: "4b2c7201ce4c03e0fb59895a2c251110" },
    };

    this.restorePromise = nearWallet
      .restore(this.walletOptions)
      .catch((error) => {
        console.warn("FastNear wallet restore failed:", error);
        return null;
      });
  }

  static _instance;

  static async instance() {
    if (this._instance) {
      return this._instance;
    }
    this._instance = new ApiManager();
    await this._instance.setUp();
    return this._instance;
  }

  async ready() {
    await this.restorePromise;
  }

  async signIn() {
    await this.ready();
    if (nearWallet.isConnected()) {
      return true;
    }
    const result = await nearWallet.connect(this.walletOptions);
    return Boolean(result && nearWallet.isConnected());
  }

  isSignedIn() {
    return nearWallet.isConnected();
  }

  accountId() {
    return nearWallet.accountId();
  }

  async sendTransaction(params) {
    return nearWallet.sendTransaction(params);
  }
}

export default ApiManager;
