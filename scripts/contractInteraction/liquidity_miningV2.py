from brownie import *
from brownie.network.contract import InterfaceContainer
import json
import time;
import copy
from scripts.utils import * 
import scripts.contractInteraction.config as conf

def setLiquidityMiningV2AddressOnAllContracts():
    print("setting LM address")
    setLiquidityMiningV2Address(conf.contracts['iDOC'])
    setLiquidityMiningV2Address(conf.contracts['iUSDT'])
    setLiquidityMiningV2Address(conf.contracts['iBPro'])
    setLiquidityMiningV2Address(conf.contracts['iXUSD'])
    setLiquidityMiningV2Address(conf.contracts['iRBTC'])

def getLiquidityMiningV2Address(loanTokenAddress):
    loanToken = Contract.from_abi("loanToken", address=loanTokenAddress, abi=LoanTokenLogicLM.abi, owner=conf.acct)
    print(loanToken.liquidityMiningAddress())
    print(loanToken.target_())

def setLiquidityMiningV2Address(loanTokenAddress):
    loanToken = Contract.from_abi("loanToken", address=loanTokenAddress, abi=LoanTokenLogicLM.abi, owner=conf.acct)
    data = loanToken.setLiquidityMiningAddress.encode_input(conf.contracts['LiquidityMiningProxyV2'])

    sendWithMultisig(conf.contracts['multisig'], loanToken.address, data, conf.acct)

def getLiquidityMiningV2AddressOnAllContracts():
    print("setting LM address")
    getLiquidityMiningV2Address(conf.contracts['iDOC'])
    getLiquidityMiningV2Address(conf.contracts['iUSDT'])
    getLiquidityMiningV2Address(conf.contracts['iBPro'])
    getLiquidityMiningV2Address(conf.contracts['iRBTC'])

def setWrapperOnLMV2():
    lm = Contract.from_abi("LiquidityMiningV2", address = conf.contracts['LiquidityMiningProxyV2'], abi = LiquidityMiningV2.abi, owner = conf.acct)

    data = lm.setWrapper.encode_input(conf.contracts['RBTCWrapperProxy'])
    sendWithMultisig(conf.contracts['multisig'], lm.address, data, conf.acct)


def getPoolIdOnLMV2(poolToken):
    lm = Contract.from_abi("LiquidityMiningV2", address = conf.contracts['LiquidityMiningProxyV2'], abi = LiquidityMiningV2.abi, owner = conf.acct)
    print(lm.getPoolId(poolToken))


def getLMV2Info():
    lm = Contract.from_abi("LiquidityMiningV2", address = conf.contracts['LiquidityMiningProxyV2'], abi = LiquidityMiningV2.abi, owner = conf.acct)
    print(lm.getPoolLength())
    print(lm.getPoolInfoList())
    print(lm.wrapper())

def setLockedSOVOnLMV2(newLockedSOV):
    lockedSOVTransferLogic = Contract.from_abi("LockedSOVRewardTransferLogic", address=conf.contracts['LockedSOVRewardTransferLogic'],abi=LockedSOVRewardTransferLogic.abi, owner = conf.acct)

    data = lockedSOVTransferLogic.changeLockedSOV.encode_input(newLockedSOV)
    sendWithMultisig(conf.contracts['multisig'], lockedSOVTransferLogic.address, data, conf.acct)

def addPoolsToLMV2():
    lm = Contract.from_abi("LiquidityMiningV2", address = conf.contracts['LiquidityMiningProxyV2'], abi = LiquidityMiningV2.abi, owner = conf.acct)
    # TODO prepare pool tokens list

    poolTokens = [conf.contracts['(WR)BTC/USDT1'], conf.contracts['(WR)BTC/USDT2'], conf.contracts['(WR)BTC/DOC1'], conf.contracts['(WR)BTC/DOC2'], conf.contracts['(WR)BTC/BPRO1'], conf.contracts['(WR)BTC/BPRO2']]
    rewardTokens = [0] * len(poolTokens)
    allocationPoints = [0] * len(poolTokens)

    # token weight = allocationPoint / SUM of allocationPoints for all pool tokens
    withUpdate = False # can be False if we adding pool tokens before mining started
    for i in range(0,len(poolTokens)):
        print('adding pool', i)
        rewardTokens[i] = [conf.contracts['SOV']]
        allocationPoints[i] = [1]

        data = lm.add.encode_input(poolTokens[i], rewardTokens[i], allocationPoints[i], withUpdate)
        print(data)
        sendWithMultisig(conf.contracts['multisig'], lm.address, data, conf.acct)

    data = lm.updateAllPools.encode_input()
    print(data)
    sendWithMultisig(conf.contracts['multisig'], lm.address, data, conf.acct)

def addMOCPoolTokenSOVRewardOnLMV2():
    lm = Contract.from_abi("LiquidityMiningV2", address = conf.contracts['LiquidityMiningProxyV2'], abi = LiquidityMiningV2.abi, owner = conf.acct)
    MAX_ALLOCATION_POINT = 100000 * 1000 # 100 M
    ALLOCATION_POINT_BTC_SOV = 30000 # (WR)BTC/SOV
    ALLOCATION_POINT_BTC_ETH = 35000 # or 30000 (WR)BTC/ETH
    ALLOCATION_POINT_DEFAULT = 1 # (WR)BTC/USDT1 | (WR)BTC/USDT2 | (WR)BTC/DOC1 | (WR)BTC/DOC2 | (WR)BTC/BPRO1 | (WR)BTC/BPRO2 | (WR)BTC/MOC
    ALLOCATION_POINT_CONFIG_TOKEN = MAX_ALLOCATION_POINT - ALLOCATION_POINT_BTC_SOV - ALLOCATION_POINT_BTC_ETH - ALLOCATION_POINT_DEFAULT * 7
    print("ALLOCATION_POINT_CONFIG_TOKEN: ", ALLOCATION_POINT_CONFIG_TOKEN)

    data = lm.add.encode_input(conf.contracts['(WR)BTC/MOC'],[conf.contracts['SOV']],[1],False)
    sendWithMultisig(conf.contracts['multisig'], lm.address, data, conf.acct)

    data = lm.update.encode_input(conf.contracts['LiquidityMiningConfigToken'],[conf.contracts['SOV']], [ALLOCATION_POINT_CONFIG_TOKEN],True)
    sendWithMultisig(conf.contracts['multisig'], lm.address, data, conf.acct)

def transferSOVtoLMV2(amount):
    lm = conf.contracts['LiquidityMiningProxyV2']
    SOVtoken = Contract.from_abi("SOV", address=conf.contracts['SOV'], abi=SOV.abi, owner=conf.acct)
    data = SOVtoken.transfer.encode_input(lm, amount)
    print(data)

    sendWithMultisig(conf.contracts['multisig'], SOVtoken.address, data, conf.acct)