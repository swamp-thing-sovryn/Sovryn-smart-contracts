from brownie import *
from brownie.network.contract import InterfaceContainer
import json
import time;
import copy
from scripts.utils import * 
import scripts.contractInteraction.config as conf

def setLiquidityMiningV1AddressOnAllContracts():
    print("setting LM address")
    setLiquidityMiningV1Address(conf.contracts['iDOC'])
    setLiquidityMiningV1Address(conf.contracts['iUSDT'])
    setLiquidityMiningV1Address(conf.contracts['iBPro'])
    setLiquidityMiningV1Address(conf.contracts['iXUSD'])
    setLiquidityMiningV1Address(conf.contracts['iRBTC'])

def getLiquidityMiningV1Address(loanTokenAddress):
    loanToken = Contract.from_abi("loanToken", address=loanTokenAddress, abi=LoanTokenLogicLM.abi, owner=conf.acct)
    print(loanToken.liquidityMiningAddress())
    print(loanToken.target_())

def setLiquidityMiningV1Address(loanTokenAddress):
    loanToken = Contract.from_abi("loanToken", address=loanTokenAddress, abi=LoanTokenLogicLM.abi, owner=conf.acct)
    data = loanToken.setLiquidityMiningAddress.encode_input(conf.contracts['LiquidityMiningProxy'])

    sendWithMultisig(conf.contracts['multisig'], loanToken.address, data, conf.acct)

def getLiquidityMiningV1AddressOnAllContracts():
    print("setting LM address")
    getLiquidityMiningV1Address(conf.contracts['iDOC'])
    getLiquidityMiningV1Address(conf.contracts['iUSDT'])
    getLiquidityMiningV1Address(conf.contracts['iBPro'])
    getLiquidityMiningV1Address(conf.contracts['iRBTC'])

def setWrapperOnLMV1():
    lm = Contract.from_abi("LiquidityMiningV1", address = conf.contracts['LiquidityMiningProxy'], abi = LiquidityMiningV1.abi, owner = conf.acct)
    data = lm.setWrapper.encode_input(conf.contracts['RBTCWrapperProxy'])
    sendWithMultisig(conf.contracts['multisig'], lm.address, data, conf.acct)


def getPoolIdOnLMV1(poolToken):
    lm = Contract.from_abi("LiquidityMiningV1", address = conf.contracts['LiquidityMiningProxy'], abi = LiquidityMiningV1.abi, owner = conf.acct)
    print(lm.getPoolId(poolToken))


def getLMV1Info():
    lm = Contract.from_abi("LiquidityMiningV1", address = conf.contracts['LiquidityMiningProxy'], abi = LiquidityMiningV1.abi, owner = conf.acct)
    print(lm.getPoolLength())
    print(lm.getPoolInfoList())
    print(lm.wrapper())

def setLockedSOVOnLMV1(newLockedSOV):
    lm = Contract.from_abi("LiquidityMiningV1", address = conf.contracts['LiquidityMiningProxy'], abi = LiquidityMiningV1.abi, owner = conf.acct)
    data = lm.setLockedSOV.encode_input(newLockedSOV)
    sendWithMultisig(conf.contracts['multisig'], lm.address, data, conf.acct)

def addPoolsToLMV1():
    liquidityMiningV1 = Contract.from_abi("LiquidityMiningV1", address = conf.contracts['LiquidityMiningProxy'], abi = LiquidityMiningV1.abi, owner = conf.acct)
    # TODO prepare pool tokens list
    poolTokens = [conf.contracts['(WR)BTC/USDT1'], conf.contracts['(WR)BTC/USDT2'], conf.contracts['(WR)BTC/DOC1'], conf.contracts['(WR)BTC/DOC2'], conf.contracts['(WR)BTC/BPRO1'], conf.contracts['(WR)BTC/BPRO2']]
    allocationPoints = [1, 1, 1, 1, 1, 1]
    # token weight = allocationPoint / SUM of allocationPoints for all pool tokens
    withUpdate = False # can be False if we adding pool tokens before mining started
    for i in range(0,len(poolTokens)):
        print('adding pool', i)
        data = liquidityMiningV1.add.encode_input(poolTokens[i], allocationPoints[i], withUpdate)
        print(data)
        sendWithMultisig(conf.contracts['multisig'], liquidityMiningV1.address, data, conf.acct)
    data = liquidityMiningV1.updateAllPools.encode_input()
    print(data)
    sendWithMultisig(conf.contracts['multisig'], liquidityMiningV1.address, data, conf.acct)

def addMOCPoolTokenOnLMV1():
    lm = Contract.from_abi("LiquidityMiningV1", address = conf.contracts['LiquidityMiningProxy'], abi = LiquidityMiningV1.abi, owner = conf.acct)
    MAX_ALLOCATION_POINT = 100000 * 1000 # 100 M
    ALLOCATION_POINT_BTC_SOV = 30000 # (WR)BTC/SOV
    ALLOCATION_POINT_BTC_ETH = 35000 # or 30000 (WR)BTC/ETH
    ALLOCATION_POINT_DEFAULT = 1 # (WR)BTC/USDT1 | (WR)BTC/USDT2 | (WR)BTC/DOC1 | (WR)BTC/DOC2 | (WR)BTC/BPRO1 | (WR)BTC/BPRO2 | (WR)BTC/MOC
    ALLOCATION_POINT_CONFIG_TOKEN = MAX_ALLOCATION_POINT - ALLOCATION_POINT_BTC_SOV - ALLOCATION_POINT_BTC_ETH - ALLOCATION_POINT_DEFAULT * 7
    print("ALLOCATION_POINT_CONFIG_TOKEN: ", ALLOCATION_POINT_CONFIG_TOKEN)
    data = lm.add.encode_input(conf.contracts['(WR)BTC/MOC'],1,False)
    sendWithMultisig(conf.contracts['multisig'], lm.address, data, conf.acct)
    data = lm.update.encode_input(conf.contracts['LiquidityMiningConfigToken'],ALLOCATION_POINT_CONFIG_TOKEN,True)
    sendWithMultisig(conf.contracts['multisig'], lm.address, data, conf.acct)

def transferSOVtoLMV1(amount):
    liquidityMiningV1 = conf.contracts['LiquidityMiningProxy']
    SOVtoken = Contract.from_abi("SOV", address=conf.contracts['SOV'], abi=SOV.abi, owner=conf.acct)
    data = SOVtoken.transfer.encode_input(liquidityMiningV1, amount)
    print(data)

    sendWithMultisig(conf.contracts['multisig'], SOVtoken.address, data, conf.acct)
