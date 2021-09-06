pragma solidity 0.5.17;

interface ILiquidityMining {
	function withdraw(
		address _poolToken,
		uint256 _amount,
		address _user
	) external;

	function onTokensDeposited(address _user, uint256 _amount) external;

	function getUserPoolTokenBalance(address _poolToken, address _user) external view returns (uint256);

	function getPoolInfoListArray()
		external
		view
		returns (
			address[] memory,
			uint96[] memory,
			uint256[] memory,
			uint256[] memory
		);

	function getUserInfoListArray(address _user)
		external
		view
		returns (
			uint256[] memory,
			uint256[] memory,
			uint256[] memory
		);

	function resetUser(address _user, uint256 _poolId) external;

	function migrateFunds() external;

	function finishMigrationGracePeriod() external;
}
