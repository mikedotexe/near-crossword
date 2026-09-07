// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract TestUSDC is ERC20 {
    bool public failTransfers;
    bool public chargeFee;
    address public callbackTarget;
    bytes public callbackData;
    bool public callbackSucceeded;
    bytes public callbackResult;

    constructor() ERC20("Test USDC", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }

    function setFailure(bool value) external {
        failTransfers = value;
    }

    function setFee(bool value) external {
        chargeFee = value;
    }

    function setCallback(address target, bytes calldata data) external {
        callbackTarget = target;
        callbackData = data;
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        if (failTransfers) return false;
        if (callbackTarget != address(0)) {
            (callbackSucceeded, callbackResult) = callbackTarget.call(callbackData);
        }
        return super.transfer(to, value);
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (failTransfers) return false;
        return super.transferFrom(from, to, value);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (chargeFee && from != address(0) && to != address(0) && value > 0) {
            super._update(from, to, value - 1);
            super._update(from, address(0), 1);
        } else {
            super._update(from, to, value);
        }
    }
}

contract TestIssuer is IERC1271 {
    address public immutable owner;
    bool public revoked;

    constructor(address owner_) {
        owner = owner_;
    }

    function setRevoked(bool value) external {
        revoked = value;
    }

    function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4) {
        (address signer, ECDSA.RecoverError error,) = ECDSA.tryRecover(hash, signature);
        return !revoked && error == ECDSA.RecoverError.NoError && signer == owner
            ? IERC1271.isValidSignature.selector
            : bytes4(0xffffffff);
    }
}

// Local-only CREATE2 fixture with the Base account factory's creation/read interface.
contract TestAccountFactory {
    address public immutable implementation;

    constructor(address implementation_) {
        implementation = implementation_;
    }

    function getAddress(bytes[] calldata owners, uint256 nonce) public view returns (address) {
        require(owners.length == 1 && owners[0].length == 32);
        bytes memory initCode =
            abi.encodePacked(type(TestIssuer).creationCode, abi.encode(abi.decode(owners[0], (address))));
        return address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            bytes1(0xff), address(this), keccak256(abi.encode(owners, nonce)), keccak256(initCode)
                        )
                    )
                )
            )
        );
    }

    function createAccount(bytes[] calldata owners, uint256 nonce) external returns (address account) {
        account = getAddress(owners, nonce);
        if (account.code.length == 0) {
            account =
                address(new TestIssuer{salt: keccak256(abi.encode(owners, nonce))}(abi.decode(owners[0], (address))));
        }
    }
}
