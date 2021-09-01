pragma solidity ^0.5.17;

import "./LiquidityMiningStorageV1.sol";
import "../proxy/UpgradableProxy.sol";

/**
 * @dev LiquidityMining contract should be upgradable, use UpgradableProxy
 */
contract LiquidityMiningProxyV1 is LiquidityMiningStorageV1, UpgradableProxy {

}
