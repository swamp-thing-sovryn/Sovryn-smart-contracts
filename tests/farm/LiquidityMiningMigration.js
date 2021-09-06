const { expect } = require("chai");
const { expectRevert, expectEvent, constants, BN } = require("@openzeppelin/test-helpers");
const { etherMantissa, mineBlock } = require("../Utils/Ethereum");

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
			const { _poolToken, _allocationPoints, _lastRewardBlock } = await liquidityMiningV1.getPoolInfoListArray();
			for (let i = 0; i < tokens.length; i++) {
				expect(_poolToken[i]).equal(tokens[i].address);
			}
		});
	});

	describe("MigratePools", () => {
		it("should only allow to migrat pools by the admin", async () => {
			await expectRevert(liquidityMiningV2.migratePools({ from: account1 }), "unauthorized");
		});
		it("should add pools from liquidityMininigV1", async () => {
			await liquidityMiningV2.migratePools();
			for (let i = 0; i < tokens.length; i++) {
				let poolToken = await liquidityMiningV2.poolInfoList(i);
				expect(poolToken).equal(tokens[i].address);
			}
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
		let allocationPoint = new BN(10);

		for (let i = 0; i < tokens.length; i++) {
			await liquidityMiningV1.add(tokens[i].address, allocationPoint, false);
		}
	}

	async function initializaAccountsTokensBalance() {
		let amount = new BN(1000);

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

	function setAccountsDepositsConstants() {
		accountDeposits = [
			{
				account: accounts[0],

				deposit: [
					{
						token: token1.address,
						amount: new BN(10),
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
						amount: new BN(25),
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
