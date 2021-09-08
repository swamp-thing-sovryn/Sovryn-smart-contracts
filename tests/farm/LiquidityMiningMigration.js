const { expect } = require("chai");
const { expectRevert, expectEvent, constants, BN } = require("@openzeppelin/test-helpers");
const { etherMantissa, mineBlock } = require("../Utils/Ethereum");
var ethers = require("ethers");
var crypto = require("crypto");

const { ZERO_ADDRESS } = constants;
const TOTAL_SUPPLY = etherMantissa(1000000000);

const TestToken = artifacts.require("TestToken");
const LiquidityMiningConfigToken = artifacts.require("LiquidityMiningConfigToken");
const LiquidityMiningLogicV1 = artifacts.require("LiquidityMiningV1Mockup");
const LiquidityMiningProxyV1 = artifacts.require("LiquidityMiningProxyV1");
const LiquidityMiningLogicV2 = artifacts.require("LiquidityMiningMockupV2");
const LiquidityMiningProxyV2 = artifacts.require("LiquidityMiningProxyV2");
const TestLockedSOV = artifacts.require("LockedSOVMockup");
const Wrapper = artifacts.require("RBTCWrapperProxyMockupV2");
const LockedSOVRewardTransferLogic = artifacts.require("LockedSOVRewardTransferLogic");
const ERC20TransferLogic = artifacts.require("ERC20TransferLogic");
const TestPoolToken = artifacts.require("TestPoolToken");

describe("LiquidityMiningMigration", () => {
	const name = "Test SOV Token";
	const symbol = "TST";

	const PRECISION = 1e12;

	const rewardTokensPerBlock = new BN(3);
	const startDelayBlocks = new BN(1);
	const numberOfBonusBlocks = new BN(50);

	// The % which determines how much will be unlocked immediately.
	/// @dev 10000 is 100%
	const unlockedImmediatelyPercent = new BN(1000); //10%

	let accounts;
	let root, account1, account2, account3, account4, account5, account6, account7, account8, account9;
	let SOVToken, token1, token2, token3, token4, token5, token6, token7, token8, liquidityMiningConfigToken;
	let liquidityMiningV1, liquidityMiningV2, wrapper;
	let rewardTransferLogic, lockedSOVAdmins, lockedSOV;
	let erc20RewardTransferLogic;
	let allocationPoint = new BN(10);

	before(async () => {
		accounts = await web3.eth.getAccounts();
		[root, account1, account2, account3, ...accounts] = accounts;
	});

	beforeEach(async () => {
		SOVToken = await TestToken.new(name, symbol, 18, TOTAL_SUPPLY);
		token1 = await TestToken.new("Test token 1", "TST-1", 18, TOTAL_SUPPLY);
		token2 = await TestToken.new("Test token 2", "TST-2", 18, TOTAL_SUPPLY);
		token3 = await TestToken.new("Test token 3", "TST-3", 18, TOTAL_SUPPLY);
		token4 = await TestToken.new("Test token 4", "TST-4", 18, TOTAL_SUPPLY);
		token5 = await TestToken.new("Test token 5", "TST-5", 18, TOTAL_SUPPLY);
		token6 = await TestToken.new("Test token 6", "TST-6", 18, TOTAL_SUPPLY);
		token7 = await TestToken.new("Test token 7", "TST-7", 18, TOTAL_SUPPLY);
		token8 = await TestToken.new("Test token 8", "TST-8", 18, TOTAL_SUPPLY);

		tokens = [token1, token2, token3, token4, token5, token6, token7, token8];

		liquidityMiningConfigToken = await LiquidityMiningConfigToken.new();
		lockedSOVAdmins = [account1, account2];

		lockedSOV = await TestLockedSOV.new(SOVToken.address, lockedSOVAdmins);

		await deployLiquidityMiningV1();
		await liquidityMiningV1.initialize(
			SOVToken.address,
			rewardTokensPerBlock,
			startDelayBlocks,
			numberOfBonusBlocks,
			wrapper.address,
			lockedSOV.address,
			unlockedImmediatelyPercent
		);

		await deployLiquidityMiningV2();
		await liquidityMiningV2.initialize(wrapper.address, liquidityMiningV1.address, SOVToken.address);

		erc20RewardTransferLogic = await ERC20TransferLogic.new();

		rewardTransferLogic = await LockedSOVRewardTransferLogic.new();
		await rewardTransferLogic.initialize(lockedSOV.address, unlockedImmediatelyPercent);

		await liquidityMiningV2.addRewardToken(SOVToken.address, rewardTokensPerBlock, startDelayBlocks, rewardTransferLogic.address);

		await liquidityMiningV1.setLiquidityMiningV2(liquidityMiningV2.address);

		//set accounts deposits pools in liquidity mining V1
		setAccountsDepositsConstants();
		//mint some tokens to all the accounts
		await initializaAccountsTokensBalance();
		//add all poolTokens to liquidityMiningV1
		await initializeLiquidityMiningV1Pools();
		//make deposits from accounts to some pools
		await initializeLiquidityMiningDeposits();
	});

	describe("initializeLiquidityMiningV1", () => {
		it("should check all user deposits", async () => {
			for (let i = 0; i < accountDeposits.length; i++) {
				for (let j = 0; j < accountDeposits[i].deposit.length; j++) {
					let poolToken = accountDeposits[i].deposit[j].token;
					let poolId = await liquidityMiningV1.getPoolId(poolToken);
					let { amount } = await liquidityMiningV1.userInfoMap(poolId, accountDeposits[i].account);
					expect(amount).bignumber.equal(accountDeposits[i].deposit[j].amount);
				}
			}
		});
		it("should check all pool have been added", async () => {
			const { _poolToken } = await liquidityMiningV1.getPoolInfoListArray();
			for (let i = 0; i < tokens.length; i++) {
				expect(_poolToken[i]).equal(tokens[i].address);
			}
		});
		it("should fail if liquidity mining V2 addres is invalid", async () => {
			await deployLiquidityMiningV1();
			await liquidityMiningV1.initialize(
				SOVToken.address,
				rewardTokensPerBlock,
				startDelayBlocks,
				numberOfBonusBlocks,
				wrapper.address,
				lockedSOV.address,
				unlockedImmediatelyPercent
			);
			await expectRevert(liquidityMiningV1.setLiquidityMiningV2(ZERO_ADDRESS), "Invalid address");
		});
	});

	describe("migratePools", () => {
		it("should only allow to migrate pools by the admin", async () => {
			await expectRevert(liquidityMiningV2.migratePools({ from: account1 }), "unauthorized");
		});
		it("should fail if liquidity mining V2 contract was not added as admin", async () => {
			await expectRevert(liquidityMiningV2.migratePools(), "unauthorized");
		});
		it("should only allow to migrate pools if migration is not finished", async () => {
			await liquidityMiningV2.finishMigration();
			await expectRevert(liquidityMiningV2.migratePools(), "Migration has already ended");
		});
		it("should only allow to migrate pools if the migrate grace period started", async () => {
			await liquidityMiningV1.addAdmin(liquidityMiningV2.address);
			await expectRevert(liquidityMiningV2.migratePools(), "Migration hasn't started yet");
		});
		it("should only allow to migrate pools once", async () => {
			await liquidityMiningV1.addAdmin(liquidityMiningV2.address);
			await liquidityMiningV1.startMigrationGracePeriod();
			await liquidityMiningV2.migratePools();
			await expectRevert(liquidityMiningV2.migratePools(), "Token already added");
		});
		it("should add pools from liquidityMininigV1", async () => {
			await liquidityMiningV1.addAdmin(liquidityMiningV2.address);
			await liquidityMiningV1.startMigrationGracePeriod();
			await liquidityMiningV2.migratePools();
			for (let i = 0; i < tokens.length; i++) {
				let poolToken = await liquidityMiningV2.poolInfoList(i);
				expect(poolToken).equal(tokens[i].address);

				let {
					allocationPoint: allocationPointV2,
					lastRewardBlock: lastRewardBlockV2,
					accumulatedRewardPerShare: accumulatedRewardPerShareV2,
				} = await liquidityMiningV2.poolInfoRewardTokensMap(i, SOVToken.address);
				let {
					allocationPoint: allocationPointV1,
					lastRewardBlock: lastRewardBlockV1,
					accumulatedRewardPerShare: accumulatedRewardPerShareV1,
				} = await liquidityMiningV1.poolInfoList(i);
				expect(allocationPointV2).bignumber.equal(allocationPointV1);
				expect(lastRewardBlockV2).bignumber.equal(lastRewardBlockV1);
				expect(accumulatedRewardPerShareV2).bignumber.equal(accumulatedRewardPerShareV1);

				let { startBlock: startBlockV2, totalUsersBalance: totalUsersBalanceV2 } = await liquidityMiningV2.rewardTokensMap(
					SOVToken.address
				);
				let startBlockV1 = await liquidityMiningV1.startBlock();
				let totalUsersBalanceV1 = await liquidityMiningV1.totalUsersBalance();

				expect(startBlockV2).bignumber.equal(startBlockV1);
				expect(totalUsersBalanceV2).bignumber.equal(totalUsersBalanceV1);
			}
		});
	});

	describe("migrateUsers", () => {
		it("should only allow to migrate users by the admin", async () => {
			await expectRevert(liquidityMiningV2.migrateUsers(accounts, { from: account1 }), "unauthorized");
		});
		it("should fail if liquidity mining V2 contract was not added as admin", async () => {
			await expectRevert(liquidityMiningV2.migrateUsers(accounts), "unauthorized");
		});
		it("should only allow to migrate users if the migrate grace period started", async () => {
			await liquidityMiningV1.addAdmin(liquidityMiningV2.address);
			await expectRevert(liquidityMiningV2.migrateUsers(accounts), "Migration hasn't started yet");
		});
		it("should only allow to migrate users if migration is not finished", async () => {
			await liquidityMiningV2.finishMigration();
			await expectRevert(liquidityMiningV2.migrateUsers(accounts), "Migration has already ended");
		});
		it("should only allow to migrate users once", async () => {
			await liquidityMiningV1.addAdmin(liquidityMiningV2.address);
			await liquidityMiningV1.startMigrationGracePeriod();
			await liquidityMiningV2.migrateUsers(accounts);
			await expectRevert(liquidityMiningV2.migrateUsers(accounts), "User already migrated");
		});
		it("should be able to migrate users in differents tx", async () => {
			let userInfoV1 = [];
			for (let i = 0; i < tokens.length; i++) {
				userInfoV1[i] = [];
				for (let j = 0; j < accountDeposits.length; j++) {
					let userInfo = await liquidityMiningV1.getUserInfo(tokens[i].address, accountDeposits[j].account);
					userInfoV1[i][j] = userInfo;
				}
			}

			await liquidityMiningV1.addAdmin(liquidityMiningV2.address);
			await liquidityMiningV1.startMigrationGracePeriod();
			await liquidityMiningV2.migratePools();
			let halfLength = accounts.length / 2;
			await liquidityMiningV2.migrateUsers(accounts.slice(0, halfLength));
			await liquidityMiningV2.migrateUsers(accounts.slice(-halfLength));

			for (let i = 0; i < tokens.length; i++) {
				for (let j = 0; j < accountDeposits.length; j++) {
					let userInfoV2 = await liquidityMiningV2.getUserInfo(tokens[i].address, accountDeposits[j].account);

					expect(userInfoV2.amount).bignumber.equal(userInfoV1[i][j].amount);
					expect(userInfoV2.rewards[0].rewardDebt).bignumber.equal(userInfoV1[i][j].rewardDebt);
					expect(userInfoV2.rewards[0].accumulatedReward).bignumber.equal(userInfoV1[i][j].accumulatedReward);
				}
			}
		});

		it("should migrate all accounts with deposits from liquidityMininigV1", async () => {
			let userInfoV1 = [];
			for (let i = 0; i < tokens.length; i++) {
				userInfoV1[i] = [];
				for (let j = 0; j < accountDeposits.length; j++) {
					let userInfo = await liquidityMiningV1.getUserInfo(tokens[i].address, accountDeposits[j].account);
					userInfoV1[i][j] = userInfo;
				}
			}

			await liquidityMiningV1.addAdmin(liquidityMiningV2.address);
			await liquidityMiningV1.startMigrationGracePeriod();
			await liquidityMiningV2.migratePools();
			await liquidityMiningV2.migrateUsers(accounts);

			for (let i = 0; i < tokens.length; i++) {
				for (let j = 0; j < accountDeposits.length; j++) {
					let userInfoV2 = await liquidityMiningV2.getUserInfo(tokens[i].address, accountDeposits[j].account);

					expect(userInfoV2.amount).bignumber.equal(userInfoV1[i][j].amount);
					expect(userInfoV2.rewards[0].rewardDebt).bignumber.equal(userInfoV1[i][j].rewardDebt);
					expect(userInfoV2.rewards[0].accumulatedReward).bignumber.equal(userInfoV1[i][j].accumulatedReward);
				}
			}
		});
		it("should migrate 75 random accounts from liquidityMininigV1", async () => {
			let randomAccounts = createRandomAccounts(75);
			await liquidityMiningV1.addAdmin(liquidityMiningV2.address);
			await liquidityMiningV1.startMigrationGracePeriod();
			await liquidityMiningV2.migratePools();
			await liquidityMiningV2.migrateUsers(randomAccounts);
		});
	});

	describe("migrateFunds", () => {
		it("should only allow to migrate funds by the admin", async () => {
			await expectRevert(liquidityMiningV2.migrateFunds({ from: account1 }), "unauthorized");
		});
		it("should fail if liquidity mining V2 contract was not added as admin", async () => {
			await expectRevert(liquidityMiningV2.migrateFunds(), "unauthorized");
		});
		it("should only allow to migrate funds if the migrate grace period started", async () => {
			await liquidityMiningV1.addAdmin(liquidityMiningV2.address);
			await expectRevert(liquidityMiningV2.migrateFunds(), "Migration hasn't started yet");
		});
		it("should only allow to migrate funds if migration is not finished", async () => {
			await liquidityMiningV2.finishMigration();
			await expectRevert(liquidityMiningV2.migrateFunds(), "Migration has already ended");
		});
		it("should fail if migrate funds without balance in liquidity mining V1", async () => {
			await liquidityMiningV1.addAdmin(liquidityMiningV2.address);
			await liquidityMiningV1.startMigrationGracePeriod();
			await liquidityMiningV2.migrateFunds();
			await expectRevert(liquidityMiningV2.migrateFunds(), "Amount invalid");
		});
		it("should fail if liquidity mining V2 is not initialized in liquidity mining V1", async () => {
			await deployLiquidityMiningV1();
			await liquidityMiningV1.initialize(
				SOVToken.address,
				rewardTokensPerBlock,
				startDelayBlocks,
				numberOfBonusBlocks,
				wrapper.address,
				lockedSOV.address,
				unlockedImmediatelyPercent
			);
			await deployLiquidityMiningV2();
			await liquidityMiningV2.initialize(wrapper.address, liquidityMiningV1.address, SOVToken.address);

			await liquidityMiningV1.addAdmin(liquidityMiningV2.address);
			await liquidityMiningV1.startMigrationGracePeriod();
			await expectRevert(liquidityMiningV2.migrateFunds(), "Address not initialized");
		});
		it("should migrate funds from liquidityMiningV1", async () => {
			let SOVBalanceV1Before = await SOVToken.balanceOf(liquidityMiningV1.address);
			let SOVBalanceV2Before = await SOVToken.balanceOf(liquidityMiningV2.address);
			let tokenBalancesV1Before = [];
			let tokenBalancesV2Before = [];
			for (let i = 0; i < tokens.length; i++) {
				tokenBalancesV1Before.push(await tokens[i].balanceOf(liquidityMiningV1.address));
				tokenBalancesV2Before.push(await tokens[i].balanceOf(liquidityMiningV2.address));
				expect(tokenBalancesV2Before[i]).bignumber.equal(new BN(0));
			}
			expect(SOVBalanceV2Before).bignumber.equal(new BN(0));
			await liquidityMiningV1.addAdmin(liquidityMiningV2.address);
			await liquidityMiningV1.startMigrationGracePeriod();
			await liquidityMiningV2.migrateFunds();

			let SOVBalanceV1After = await SOVToken.balanceOf(liquidityMiningV1.address);
			let SOVBalanceV2After = await SOVToken.balanceOf(liquidityMiningV2.address);
			let tokenBalancesV1After = [];
			let tokenBalancesV2After = [];
			for (let i = 0; i < tokens.length; i++) {
				tokenBalancesV1After.push(await tokens[i].balanceOf(liquidityMiningV1.address));
				tokenBalancesV2After.push(await tokens[i].balanceOf(liquidityMiningV2.address));
				expect(tokenBalancesV1After[i]).bignumber.equal(new BN(0));
				expect(tokenBalancesV2After[i]).bignumber.equal(tokenBalancesV1Before[i]);
			}
			expect(SOVBalanceV1After).bignumber.equal(new BN(0));
			expect(SOVBalanceV2After).bignumber.equal(SOVBalanceV1Before);
		});
	});

	describe("withdraws", () => {
		it("should withdraw all before migration and revert trying to withdraw after", async () => {
			await liquidityMiningV1.withdraw(accountDeposits[0].deposit[0].token, accountDeposits[0].deposit[0].amount, ZERO_ADDRESS, {
				from: accountDeposits[0].account,
			});

			await liquidityMiningV1.addAdmin(liquidityMiningV2.address);
			await liquidityMiningV1.startMigrationGracePeriod();
			await liquidityMiningV2.migratePools();
			await liquidityMiningV2.migrateUsers(accounts);
			await liquidityMiningV2.migrateFunds();

			await expectRevert(
				liquidityMiningV2.withdraw(accountDeposits[0].deposit[0].token, accountDeposits[0].deposit[0].amount, ZERO_ADDRESS, {
					from: accountDeposits[0].account,
				}),
				"Not enough balance"
			);
		});
		it("should withdraw half before migration and withdraw the other half after", async () => {
			await liquidityMiningV1.addAdmin(liquidityMiningV2.address);
			await liquidityMiningV1.startMigrationGracePeriod();
			tokenBalanceBefore = await token1.balanceOf(accountDeposits[0].account);
			await liquidityMiningV1.withdraw(
				accountDeposits[0].deposit[0].token,
				accountDeposits[0].deposit[0].amount.div(new BN(2)),
				ZERO_ADDRESS,
				{ from: accountDeposits[0].account }
			);

			await liquidityMiningV2.migratePools();
			await liquidityMiningV2.migrateUsers([accountDeposits[0].account]);
			await liquidityMiningV2.migrateFunds();
			await liquidityMiningV2.withdraw(
				accountDeposits[0].deposit[0].token,
				accountDeposits[0].deposit[0].amount.div(new BN(2)),
				ZERO_ADDRESS,
				{ from: accountDeposits[0].account }
			);

			tokenBalanceAfter = await token1.balanceOf(accountDeposits[0].account);

			expect(tokenBalanceAfter.sub(tokenBalanceBefore)).bignumber.equal(accountDeposits[0].deposit[0].amount);
		});
		it("should withdraw all before migration, migrate, deposit and withdraw all again", async () => {
			//Re-initialization of liquidity mining contracts
			await deployLiquidityMiningV1();
			await liquidityMiningV1.initialize(
				SOVToken.address,
				rewardTokensPerBlock,
				startDelayBlocks,
				new BN(0),
				wrapper.address,
				lockedSOV.address,
				new BN(0)
			);
			await deployLiquidityMiningV2();
			await liquidityMiningV2.initialize(wrapper.address, liquidityMiningV1.address, SOVToken.address);
			await liquidityMiningV1.setLiquidityMiningV2(liquidityMiningV2.address);

			rewardTransferLogic = await LockedSOVRewardTransferLogic.new();
			await rewardTransferLogic.initialize(lockedSOV.address, new BN(0));

			await liquidityMiningV2.addRewardToken(SOVToken.address, rewardTokensPerBlock, startDelayBlocks, rewardTransferLogic.address);

			await liquidityMiningV1.add(accountDeposits[0].deposit[0].token, allocationPoint, false);

			await SOVToken.mint(liquidityMiningV1.address, new BN(1000));

			await token1.approve(liquidityMiningV1.address, accountDeposits[0].deposit[0].amount, { from: accountDeposits[0].account });
			await liquidityMiningV1.deposit(token1.address, accountDeposits[0].deposit[0].amount, ZERO_ADDRESS, {
				from: accountDeposits[0].account,
			});
			await mineBlocks(20);

			await liquidityMiningV1.withdraw(token1.address, accountDeposits[0].deposit[0].amount, ZERO_ADDRESS, {
				from: accountDeposits[0].account,
			});
			let balanceLockedBefore = await lockedSOV.getLockedBalance(accountDeposits[0].account);

			await liquidityMiningV1.addAdmin(liquidityMiningV2.address);
			await liquidityMiningV1.startMigrationGracePeriod();
			await liquidityMiningV2.migratePools();
			await liquidityMiningV2.migrateUsers([accountDeposits[0].account]);
			await liquidityMiningV2.migrateFunds();
			await liquidityMiningV2.finishMigration();

			await token1.approve(liquidityMiningV2.address, accountDeposits[0].deposit[0].amount, { from: accountDeposits[0].account });
			await liquidityMiningV2.deposit(token1.address, accountDeposits[0].deposit[0].amount, ZERO_ADDRESS, {
				from: accountDeposits[0].account,
			});
			await mineBlocks(20);

			await liquidityMiningV2.withdraw(token1.address, accountDeposits[0].deposit[0].amount, ZERO_ADDRESS, {
				from: accountDeposits[0].account,
			});
			let balanceLockedAfter = await lockedSOV.getLockedBalance(accountDeposits[0].account);

			expect(balanceLockedAfter).bignumber.equal(balanceLockedBefore.mul(new BN(2)));
		});
		it("should get rewards in liquidity mining V2 after migration", async () => {
			//Re-initialization of liquidity mining contracts
			await deployLiquidityMiningV1();
			await liquidityMiningV1.initialize(
				SOVToken.address,
				rewardTokensPerBlock,
				startDelayBlocks,
				new BN(0),
				wrapper.address,
				lockedSOV.address,
				new BN(0)
			);
			await deployLiquidityMiningV2();
			await liquidityMiningV2.initialize(wrapper.address, liquidityMiningV1.address, SOVToken.address);
			await liquidityMiningV1.setLiquidityMiningV2(liquidityMiningV2.address);

			rewardTransferLogic = await LockedSOVRewardTransferLogic.new();
			await rewardTransferLogic.initialize(lockedSOV.address, new BN(0));

			await liquidityMiningV2.addRewardToken(SOVToken.address, rewardTokensPerBlock, startDelayBlocks, rewardTransferLogic.address);

			await liquidityMiningV1.add(accountDeposits[0].deposit[0].token, allocationPoint, false);

			await SOVToken.mint(liquidityMiningV1.address, new BN(1000));

			await token1.approve(liquidityMiningV1.address, accountDeposits[0].deposit[0].amount, { from: accountDeposits[0].account });
			await liquidityMiningV1.deposit(token1.address, accountDeposits[0].deposit[0].amount, ZERO_ADDRESS, {
				from: accountDeposits[0].account,
			});
			await mineBlocks(1);

			tx = await liquidityMiningV1.withdraw(token1.address, accountDeposits[0].deposit[0].amount.div(new BN(2)), ZERO_ADDRESS, {
				from: accountDeposits[0].account,
			});
			let blockStart = tx.receipt.blockNumber;
			let balanceLockedBefore = await lockedSOV.getLockedBalance(accountDeposits[0].account);

			await liquidityMiningV1.addAdmin(liquidityMiningV2.address);
			await liquidityMiningV1.startMigrationGracePeriod();

			await mineBlocks(10);

			await liquidityMiningV2.migratePools();
			await liquidityMiningV2.migrateUsers([accountDeposits[0].account]);
			await liquidityMiningV2.migrateFunds();

			tx = await liquidityMiningV2.withdraw(token1.address, accountDeposits[0].deposit[0].amount.div(new BN(2)), ZERO_ADDRESS, {
				from: accountDeposits[0].account,
			});
			let blockEnd = tx.receipt.blockNumber;
			let passedBlocks = new BN(blockEnd - blockStart);
			let reward = passedBlocks.mul(rewardTokensPerBlock);
			let balanceLockedAfter = await lockedSOV.getLockedBalance(accountDeposits[0].account);

			expect(balanceLockedAfter).bignumber.equal(balanceLockedBefore.add(reward));
		});
		it("should migrate rewards", async () => {
			//Re-initialization of liquidity mining contracts
			await deployLiquidityMiningV1();
			await liquidityMiningV1.initialize(
				SOVToken.address,
				rewardTokensPerBlock,
				startDelayBlocks,
				new BN(0),
				wrapper.address,
				lockedSOV.address,
				new BN(0)
			);
			await deployLiquidityMiningV2();
			await liquidityMiningV2.initialize(wrapper.address, liquidityMiningV1.address, SOVToken.address);
			await liquidityMiningV1.setLiquidityMiningV2(liquidityMiningV2.address);

			rewardTransferLogic = await LockedSOVRewardTransferLogic.new();
			await rewardTransferLogic.initialize(lockedSOV.address, new BN(0));

			await liquidityMiningV2.addRewardToken(SOVToken.address, rewardTokensPerBlock, startDelayBlocks, rewardTransferLogic.address);

			await liquidityMiningV1.add(accountDeposits[0].deposit[0].token, allocationPoint, false);

			await SOVToken.mint(liquidityMiningV1.address, new BN(1000));

			await token1.approve(liquidityMiningV1.address, accountDeposits[0].deposit[0].amount, { from: accountDeposits[0].account });
			await liquidityMiningV1.deposit(token1.address, accountDeposits[0].deposit[0].amount, ZERO_ADDRESS, {
				from: accountDeposits[0].account,
			});
			await mineBlocks(10);

			await liquidityMiningV1.claimReward(token1.address, ZERO_ADDRESS, { from: accountDeposits[0].account });
			let { rewardDebt: rewardDebtBefore } = await liquidityMiningV1.userInfoMap(0, accountDeposits[0].account);

			await liquidityMiningV1.addAdmin(liquidityMiningV2.address);
			await liquidityMiningV1.startMigrationGracePeriod();
			await liquidityMiningV2.migratePools();
			await liquidityMiningV2.migrateUsers([accountDeposits[0].account]);
			await liquidityMiningV2.migrateFunds();

			let userInfoV2 = await liquidityMiningV2.getUserInfo(token1.address, accountDeposits[0].account);
			let rewardDebtAfter = userInfoV2.rewards[0].rewardDebt;

			expect(rewardDebtAfter).bignumber.equal(rewardDebtBefore);
		});
		it("should be able to claim rewards after migration", async () => {
			//Re-initialization of liquidity mining contracts
			await deployLiquidityMiningV1();
			await liquidityMiningV1.initialize(
				SOVToken.address,
				rewardTokensPerBlock,
				startDelayBlocks,
				new BN(0),
				wrapper.address,
				lockedSOV.address,
				new BN(0)
			);
			await deployLiquidityMiningV2();
			await liquidityMiningV2.initialize(wrapper.address, liquidityMiningV1.address, SOVToken.address);
			await liquidityMiningV1.setLiquidityMiningV2(liquidityMiningV2.address);

			rewardTransferLogic = await LockedSOVRewardTransferLogic.new();
			await rewardTransferLogic.initialize(lockedSOV.address, new BN(0));

			await liquidityMiningV2.addRewardToken(SOVToken.address, rewardTokensPerBlock, startDelayBlocks, rewardTransferLogic.address);

			await liquidityMiningV1.add(accountDeposits[0].deposit[0].token, allocationPoint, false);

			await SOVToken.mint(liquidityMiningV1.address, new BN(1000));

			await token1.approve(liquidityMiningV1.address, accountDeposits[0].deposit[0].amount, { from: accountDeposits[0].account });
			await liquidityMiningV1.deposit(token1.address, accountDeposits[0].deposit[0].amount, ZERO_ADDRESS, {
				from: accountDeposits[0].account,
			});
			await mineBlocks(10);

			tx = await liquidityMiningV1.claimReward(token1.address, ZERO_ADDRESS, { from: accountDeposits[0].account });
			let blockStart = tx.receipt.blockNumber;
			let { rewardDebt: rewardDebtBefore } = await liquidityMiningV1.userInfoMap(0, accountDeposits[0].account);

			await liquidityMiningV1.addAdmin(liquidityMiningV2.address);
			await liquidityMiningV1.startMigrationGracePeriod();

			await mineBlocks(10);

			await liquidityMiningV2.migratePools();
			await liquidityMiningV2.migrateUsers([accountDeposits[0].account]);
			await liquidityMiningV2.migrateFunds();

			tx = await liquidityMiningV2.claimRewards(token1.address, ZERO_ADDRESS, { from: accountDeposits[0].account });
			let blockEnd = tx.receipt.blockNumber;
			let passedBlocks = new BN(blockEnd - blockStart);
			let rewardDebt = passedBlocks.mul(rewardTokensPerBlock);
			let userInfoV2 = await liquidityMiningV2.getUserInfo(token1.address, accountDeposits[0].account);
			let rewardDebtAfter = userInfoV2.rewards[0].rewardDebt;

			expect(rewardDebtAfter).bignumber.equal(rewardDebtBefore.add(rewardDebt));
		});
	});

	async function deployLiquidityMiningV1() {
		let liquidityMiningLogicV1 = await LiquidityMiningLogicV1.new();
		let liquidityMiningProxyV1 = await LiquidityMiningProxyV1.new();
		await liquidityMiningProxyV1.setImplementation(liquidityMiningLogicV1.address);
		liquidityMiningV1 = await LiquidityMiningLogicV1.at(liquidityMiningProxyV1.address);

		wrapper = await Wrapper.new(liquidityMiningV1.address);
	}

	async function deployLiquidityMiningV2() {
		let liquidityMiningLogicV2 = await LiquidityMiningLogicV2.new();
		let liquidityMiningProxyV2 = await LiquidityMiningProxyV2.new();
		await liquidityMiningProxyV2.setImplementation(liquidityMiningLogicV2.address);
		liquidityMiningV2 = await LiquidityMiningLogicV2.at(liquidityMiningProxyV2.address);

		wrapper = await Wrapper.new(liquidityMiningV2.address);
	}

	async function initializeLiquidityMiningV1Pools() {
		for (let i = 0; i < tokens.length; i++) {
			await liquidityMiningV1.add(tokens[i].address, allocationPoint, false);
		}
	}

	async function initializaAccountsTokensBalance() {
		let amount = new BN(1000);
		await SOVToken.mint(liquidityMiningV1.address, amount);
		tokens.forEach((token) => {
			accounts.forEach(async (account) => {
				await token.mint(account, amount);
				await token.approve(liquidityMiningV1.address, amount, { from: account });
			});
		});
	}

	async function initializeLiquidityMiningDeposits() {
		accountDeposits.forEach((account) => {
			account.deposit.forEach(async (deposit) => {
				await liquidityMiningV1.deposit(deposit.token, deposit.amount, ZERO_ADDRESS, { from: account.account });
			});
		});
	}

	function createRandomAccounts(length) {
		const randomAccounts = [];
		for (let i = 0; i < length; i++) {
			let id = crypto.randomBytes(32).toString("hex");
			let privateKey = "0x" + id;
			let wallet = new ethers.Wallet(privateKey);
			randomAccounts.push(wallet.address);
		}
		return randomAccounts;
	}

	function setAccountsDepositsConstants() {
		accountDeposits = [
			{
				account: accounts[0],

				deposit: [
					{
						token: token1.address,
						amount: new BN(100),
					},
					{
						token: token2.address,
						amount: new BN(10),
					},
					{
						token: token3.address,
						amount: new BN(10),
					},
					{
						token: token4.address,
						amount: new BN(10),
					},
					{
						token: token5.address,
						amount: new BN(10),
					},
					{
						token: token6.address,
						amount: new BN(10),
					},
					{
						token: token7.address,
						amount: new BN(10),
					},
					{
						token: token8.address,
						amount: new BN(10),
					},
				],
			},
			{
				account: accounts[1],

				deposit: [
					{
						token: token1.address,
						amount: new BN(5),
					},
					{
						token: token2.address,
						amount: new BN(5),
					},
					{
						token: token3.address,
						amount: new BN(5),
					},
					{
						token: token4.address,
						amount: new BN(5),
					},
				],
			},
			{
				account: accounts[2],

				deposit: [
					{
						token: token1.address,
						amount: new BN(55),
					},
				],
			},
			{
				account: accounts[3],

				deposit: [
					{
						token: token8.address,
						amount: new BN(1000),
					},
				],
			},
			{
				account: accounts[4],

				deposit: [
					{
						token: token6.address,
						amount: new BN(25),
					},
					{
						token: token7.address,
						amount: new BN(100),
					},
					{
						token: token8.address,
						amount: new BN(100),
					},
				],
			},
			{
				account: accounts[5],

				deposit: [
					{
						token: token1.address,
						amount: new BN(25),
					},
					{
						token: token3.address,
						amount: new BN(100),
					},
					{
						token: token8.address,
						amount: new BN(100),
					},
				],
			},
			{
				account: accounts[6],

				deposit: [
					{
						token: token2.address,
						amount: new BN(25),
					},
					{
						token: token4.address,
						amount: new BN(100),
					},
					{
						token: token6.address,
						amount: new BN(100),
					},
				],
			},
			{
				account: accounts[7],

				deposit: [
					{
						token: token3.address,
						amount: new BN(25),
					},
					{
						token: token5.address,
						amount: new BN(100),
					},
					{
						token: token7.address,
						amount: new BN(100),
					},
				],
			},
			{
				account: accounts[8],

				deposit: [
					{
						token: token4.address,
						amount: new BN(25),
					},
					{
						token: token5.address,
						amount: new BN(100),
					},
					{
						token: token6.address,
						amount: new BN(100),
					},
				],
			},
		];
	}

	async function mineBlocks(blocks) {
		for (let i = 0; i < blocks; i++) {
			await mineBlock();
		}
	}
});
