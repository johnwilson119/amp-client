// @flow
import { getAccountBalancesDomain, getAccountDomain, getTokenDomain, getSendEtherFormDomain } from '../domains'

import * as actionCreators from '../actions/walletPage'
import * as notifierActionCreators from '../actions/app'
import * as accountActionTypes from '../actions/account'
import * as accountBalancesService from '../services/accountBalances'
import { quoteTokens, quoteTokenSymbols } from '../../config/quotes'
import { getCurrentBlock } from '../services/wallet'
import { push } from 'connected-react-router'
import type { Token } from '../../types/common'
import type { State, ThunkAction } from '../../types'
import { ALLOWANCE_THRESHOLD } from '../../utils/constants'

export default function walletPageSelector(state: State) {
  let accountBalancesDomain = getAccountBalancesDomain(state)
  let accountDomain = getAccountDomain(state)
  let tokenDomain = getTokenDomain(state)
  let sendEtherFormDomain = getSendEtherFormDomain(state)

  // ETH is not a token so we add it to the list to display in the deposit table
  // let WETH = tokenDomain.token('WETH')
  // let quoteTokens = tokenDomain.tokens().filter((token: Token) => quoteTokens.indexOf(token.symbol) !== -1 && token.symbol !== 'WETH' && token.symbol !== 'ETH')
  // let baseTokens = tokenDomain.tokens().filter((token: Token) => quoteTokens.indexOf(token.symbol) === -1 && token.symbol !== 'WETH' && token.symbol !== 'ETH')
  let ETH = { symbol: 'ETH' }
  let tokens = tokenDomain.tokens()
  let quoteTokens = quoteTokenSymbols
  let baseTokens = tokenDomain.symbols().filter(symbol => quoteTokens.indexOf(symbol) !== -1)
  let tokenData = accountBalancesDomain.getBalancesAndAllowances([ ETH ].concat(tokens))

  return {
    etherBalance: accountBalancesDomain.formattedEtherBalance(),
    tokenData: tokenData,
    quoteTokens: quoteTokens,
    baseTokens: baseTokens,
    accountAddress: accountDomain.address(),
    authenticated: accountDomain.authenticated(),
    currentBlock: accountDomain.currentBlock(),
    connected: true,
    gas: sendEtherFormDomain.getGas(),
    gasPrice: sendEtherFormDomain.getGasPrice()
  }
}

export function queryAccountData(): ThunkAction {
  return async (dispatch, getState) => {
    const state = getState()
    const accountAddress = getAccountDomain(state).address()

    try {
      let tokens = getTokenDomain(state).tokens()
      let quotes = quoteTokens

      tokens = quotes.concat(tokens).filter((token: Token) => token.symbol !== 'ETH')
      if (!accountAddress) throw new Error('Account address is not set')

      const etherBalance = await accountBalancesService.queryEtherBalance(accountAddress)
      const tokenBalances = await accountBalancesService.queryTokenBalances(accountAddress, tokens)
      const allowances = await accountBalancesService.queryExchangeTokenAllowances(accountAddress, tokens)
      const balances = [etherBalance].concat(tokenBalances)
      const currentBlock = await getCurrentBlock()

      dispatch(accountActionTypes.updateCurrentBlock(currentBlock))
      dispatch(actionCreators.updateBalances(balances))
      dispatch(actionCreators.updateAllowances(allowances))

      await accountBalancesService.subscribeTokenBalances(accountAddress, tokens, balance =>
        dispatch(actionCreators.updateBalance(balance))
      )

      await accountBalancesService.subscribeTokenAllowances(accountAddress, tokens, allowance => {
        return dispatch(actionCreators.updateAllowance(allowance))
      })
    } catch (e) {
      dispatch(notifierActionCreators.addDangerNotification({ message: 'Could not connect to Ethereum network' }))
      console.log(e)
    }
  }
}

export function redirectToTradingPage(symbol: string): ThunkAction {
  return async (dispatch, getState) => {
    let defaultQuoteToken = quoteTokens[0]
    let pair = `${symbol}/${defaultQuoteToken.symbol}`

    dispatch(actionCreators.updateCurrentPair(pair))
    dispatch(push('/trade'))
  }
}

export function toggleAllowance(tokenSymbol: string): ThunkAction {
  return async (dispatch, getState) => {
    try {
      const state = getState()
      const tokens = getTokenDomain(state).bySymbol()
      const accountAddress = getAccountDomain(state).address()
      const isAllowed = getAccountBalancesDomain(state).isAllowed(tokenSymbol)
      const isPending = getAccountBalancesDomain(state).isAllowancePending(tokenSymbol)

      const tokenContractAddress = tokens[tokenSymbol].address

      if (isPending) throw new Error('Trading approval pending')

      if (isAllowed) {
        await accountBalancesService.updateExchangeAllowance(tokenContractAddress, accountAddress, 0)
      } else {
        await accountBalancesService.updateExchangeAllowance(tokenContractAddress, accountAddress, ALLOWANCE_THRESHOLD)
      }

      dispatch(actionCreators.updateAllowance({ symbol: tokenSymbol, allowance: 'pending' }))
      dispatch(
        notifierActionCreators.addSuccessNotification({
          message: 'Allowance pending. You will be able to trade after transaction is validated'
        })
      )
    } catch (e) {
      console.log(e)
      if (e.message === 'Trading approval pending') {
        dispatch(notifierActionCreators.addDangerNotification({ message: 'Trading approval pending' }))
      }
    }
  }
}
