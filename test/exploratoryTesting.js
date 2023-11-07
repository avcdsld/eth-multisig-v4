require('assert');
const should = require('should');
const _ = require('lodash');
const hre = require('hardhat');
const BigNumber = require('bignumber.js');
const helpers = require('./helpers');
const {
  assertVMException,
  calculateFutureExpireTime,
  createWalletHelper,
} = require('./wallet/helpers');
const { privateKeyForAccount } = require('./helpers');
const util = require('ethereumjs-util');
const EthWalletSimple = artifacts.require('./WalletSimple.sol');
const GasGuzzler = artifacts.require('./GasGuzzler.sol');
const Batcher = artifacts.require('./Batcher.sol');

const coins = [
  {
    name: 'Eth',
    nativePrefix: 'ETHER',
    nativeBatchPrefix: 'ETHER-Batch',
    tokenPrefix: 'ERC20',
    WalletSimple: EthWalletSimple
  },
];

coins.forEach(
  ({
    name: coinName,
    nativePrefix,
    nativeBatchPrefix,
    tokenPrefix,
    WalletSimple
  }) => {
    const createWallet = (creator, signers) => {
      return createWalletHelper(WalletSimple, creator, signers);
    };

    describe(`Exploratory Testing - ${coinName}WalletSimple`, function () {
      let wallet;
      let accounts;
      before(async () => {
        await hre.network.provider.send('hardhat_reset');
        accounts = await web3.eth.getAccounts();
      });

      const sendMultiSigTestHelper = async function (params) {
        assert(params.msgSenderAddress);
        assert(params.otherSignerAddress);
        assert(params.wallet);

        assert(params.toAddress);
        assert(params.amount === 0 || params.amount);
        assert(params.data === '' || params.data);
        assert(params.expireTime);
        assert(params.sequenceId);

        const otherSignerArgs = _.extend({}, params, params.otherSignerArgs);
        const msgSenderArgs = _.extend({}, params, params.msgSenderArgs);

        const operationHash = helpers.getSha3ForConfirmationTx(
          params.prefix || nativePrefix,
          otherSignerArgs.toAddress.toLowerCase(),
          web3.utils.toWei(otherSignerArgs.amount.toString(), 'ether'),
          otherSignerArgs.data,
          otherSignerArgs.expireTime,
          otherSignerArgs.sequenceId
        );
        const sig = params.sig || util.ecsign(
          operationHash,
          privateKeyForAccount(params.otherSignerAddress)
        );

        await params.wallet.sendMultiSig(
          msgSenderArgs.toAddress.toLowerCase(),
          web3.utils.toWei(web3.utils.toBN(msgSenderArgs.amount), 'ether'),
          util.addHexPrefix(msgSenderArgs.data),
          msgSenderArgs.expireTime,
          msgSenderArgs.sequenceId,
          helpers.serializeSignature(sig),
          { from: params.msgSenderAddress }
        );

        return sig;
      };

      const sendMultiSigBatchTestHelper = async function (params) {
        assert(params.msgSenderAddress);
        assert(params.otherSignerAddress);
        assert(params.wallet);

        assert(params.recipients);
        assert(params.values);
        assert(params.expireTime);
        assert(params.sequenceId);

        // For testing, allow arguments to override the parameters above,
        // as if the other signer or message sender were changing them
        const otherSignerArgs = _.extend({}, params, params.otherSignerArgs);
        const msgSenderArgs = _.extend({}, params, params.msgSenderArgs);

        // Get the operation hash to be signed
        const operationHash = helpers.getSha3ForBatchTx(
          params.prefix || nativeBatchPrefix,
          otherSignerArgs.recipients.map((recipient) =>
            recipient.toLowerCase()
          ),
          otherSignerArgs.values.map((value) =>
            web3.utils.toWei(value.toString(), 'ether')
          ),
          otherSignerArgs.expireTime,
          otherSignerArgs.sequenceId
        );
        const sig = util.ecsign(
          operationHash,
          privateKeyForAccount(params.otherSignerAddress)
        );

        await params.wallet.sendMultiSigBatch(
          msgSenderArgs.recipients,
          msgSenderArgs.values.map((value) =>
            web3.utils.toWei(value.toString(), 'ether')
          ),
          msgSenderArgs.expireTime,
          msgSenderArgs.sequenceId,
          helpers.serializeSignature(sig),
          { from: params.msgSenderAddress, gas: params.gas }
        );
      };

      const getSendMultiSigTxData = function (params) {
        assert(params.msgSenderWallet);
        assert(params.otherSignerAddress);
        assert(params.wallet);

        assert(params.toAddress);
        assert(params.amount);
        assert(params.data === '' || params.data);
        assert(params.expireTime);
        assert(params.sequenceId);

        const otherSignerArgs = _.extend({}, params, params.otherSignerArgs);
        const msgSenderArgs = _.extend({}, params, params.msgSenderArgs);

        const operationHash = helpers.getSha3ForConfirmationTx(
          params.prefix || nativePrefix,
          otherSignerArgs.toAddress.toLowerCase(),
          web3.utils.toWei(otherSignerArgs.amount.toString(), 'ether'),
          otherSignerArgs.data,
          otherSignerArgs.expireTime,
          otherSignerArgs.sequenceId
        );
        const sig = util.ecsign(
          operationHash,
          privateKeyForAccount(params.otherSignerAddress)
        );

        const iface = new ethers.utils.Interface([
          "function sendMultiSig(address toAddress, uint256 value, bytes calldata data, uint256 expireTime, uint256 sequenceId, bytes calldata signature) external"
        ]);
        const txData = iface.encodeFunctionData("sendMultiSig", [
          msgSenderArgs.toAddress.toLowerCase(),
          web3.utils.toWei(web3.utils.toBN(msgSenderArgs.amount), 'ether').toString(),
          util.addHexPrefix(msgSenderArgs.data),
          msgSenderArgs.expireTime,
          msgSenderArgs.sequenceId,
          helpers.serializeSignature(sig)
        ]);

        return txData;
      };

      describe('Unexpected signer', function () {
        let unexpectedSigner;
        before(async function () {
          unexpectedSigner = await createWallet(accounts[2], [
            accounts[2],
            accounts[3],
            accounts[4],
          ]);

          wallet = await createWallet(accounts[0], [
            accounts[0],
            accounts[1],
            unexpectedSigner.address,
          ]);

          await web3.eth.sendTransaction({
            from: accounts[0],
            to: wallet.address,
            value: web3.utils.toWei('2000', 'ether'),
          });
        });

        let sequenceId;
        beforeEach(async function () {
          sequenceId = parseInt(await wallet.getNextSequenceId.call());
        });

        it('There could be more than 3 signers, actually', async function () {
          // If a contract becomes a signer, an unexpected address may have authority
          const innerParams = {
            msgSenderWallet: unexpectedSigner,
            otherSignerAddress: accounts[1],
            wallet,
            toAddress: accounts[5],
            amount: 6,
            data: '',
            expireTime: calculateFutureExpireTime(120),
            sequenceId,
          };
          const data = getSendMultiSigTxData(innerParams);

          const params = {
            msgSenderAddress: accounts[2],
            otherSignerAddress: accounts[3],
            wallet: unexpectedSigner,
            toAddress: wallet.address,
            amount: 0,
            data,
            expireTime: calculateFutureExpireTime(120),
            sequenceId: parseInt(await unexpectedSigner.getNextSequenceId.call()),
          };
          await sendMultiSigTestHelper(params);
        });
      });

      describe('Reuse of signatures', function () {
        let anotherWallet;
        before(async function () {
          wallet = await createWallet(accounts[0], [
            accounts[0],
            accounts[1],
            accounts[2],
          ]);

          anotherWallet = await createWallet(accounts[0], [
            accounts[0],
            accounts[1],
            accounts[2],
          ]);

          await web3.eth.sendTransaction({
            from: accounts[0],
            to: wallet.address,
            value: web3.utils.toWei('2000', 'ether')
          });

          await web3.eth.sendTransaction({
            from: accounts[0],
            to: anotherWallet.address,
            value: web3.utils.toWei('2000', 'ether')
          });
        });

        let sequenceId;
        beforeEach(async function () {
          sequenceId = parseInt(await wallet.getNextSequenceId.call());
        });

        it('Signature could be reused', async function () {
          // If the same signer is used for multiple wallets, the signature could be reused.
          const params = {
            msgSenderAddress: accounts[1],
            otherSignerAddress: accounts[2],
            wallet,
            toAddress: accounts[5],
            amount: 6,
            data: '',
            expireTime: calculateFutureExpireTime(120),
            sequenceId,
          };
          const sig = await sendMultiSigTestHelper(params);

          const anotherParams = {
            msgSenderAddress: params.msgSenderAddress,
            otherSignerAddress: params.otherSignerAddress,
            wallet: anotherWallet,
            toAddress: params.toAddress,
            amount: params.amount,
            data: params.data,
            expireTime: params.expireTime,
            sequenceId: params.sequenceId,
            sig,
          };
          await sendMultiSigTestHelper(anotherParams);
        });
      });

      describe('Greedy Batcher', function () {
        let batcherInstance;
        let batcherOwner;

        before(async function () {
          batcherOwner = accounts[8];
          batcherInstance = await Batcher.new({ from: batcherOwner });
        });

        it('ETH may remain in the Batcher and anyone can steal it', async function () {
          const recipients = [accounts[5], accounts[6], accounts[7], accounts[8], accounts[9]];
          const values = [1, 1, 1, 1, 1];
          const totalValue = _.sum(values);
          const excessValue = 5;
          await batcherInstance.batch(recipients, values, {
            value: totalValue + excessValue, // Total ETH does not match
          });
          const balance = await web3.eth.getBalance(
            batcherInstance.address
          );
          new BigNumber(excessValue).eq(balance).should.be.true();

          const attackerRecipients = [accounts[1]];
          const attackerValue = [excessValue];
          await batcherInstance.batch(attackerRecipients, attackerValue, {
            from: accounts[1],
            value: 0,
          });
          const afterBalance = await web3.eth.getBalance(
            batcherInstance.address
          );
          new BigNumber(0).eq(afterBalance).should.be.true();
        });
      });

      describe('Malicious recipients', function () {
        let gasGuzzlerInstance;

        before(async function () {
          wallet = await createWallet(accounts[0], [
            accounts[0],
            accounts[1],
            accounts[2],
          ]);

          await web3.eth.sendTransaction({
            from: accounts[0],
            to: wallet.address,
            value: web3.utils.toWei('2000', 'ether'),
          });

          gasGuzzlerInstance = await GasGuzzler.new();
        });

        let sequenceId;
        beforeEach(async function () {
          sequenceId = parseInt(await wallet.getNextSequenceId.call());
        });

        it('All gas is used by malicious recipients because there is no gas limit', async function () {
          const params = {
            msgSenderAddress: accounts[0],
            otherSignerAddress: accounts[1],
            wallet,
            recipients: [gasGuzzlerInstance.address, accounts[5]],
            values: [2, 3],
            expireTime: calculateFutureExpireTime(120),
            sequenceId,
            gas: '30000000', // Large gas limit (= block gas limit)
          };

          const beforeBalance = await web3.eth.getBalance(accounts[0]);
          try {
            await sendMultiSigBatchTestHelper(params);
            throw new Error('should not have sent successfully');
          } catch (err) {
            assertVMException(err, 'Call failed');
          }
          const afterBalance = await web3.eth.getBalance(accounts[0]);
          const usedGas = BigNumber(beforeBalance).minus(afterBalance);
          
          sequenceId++;
          const params2 = {
            msgSenderAddress: accounts[0],
            otherSignerAddress: accounts[1],
            wallet,
            recipients: [gasGuzzlerInstance.address, accounts[5]],
            values: [2, 3],
            expireTime: calculateFutureExpireTime(120),
            sequenceId,
            gas: '200000', // Appropriate gas limit
          };
          const beforeBalance2 = await web3.eth.getBalance(accounts[0]);
          try {
            await sendMultiSigBatchTestHelper(params2);
            throw new Error('should not have sent successfully');
          } catch (err) {
            assertVMException(err, 'Call failed');
          }
          const afterBalance2 = await web3.eth.getBalance(accounts[0]);
          const usedGas2 = BigNumber(beforeBalance2).minus(afterBalance2);
          
          usedGas.gt(usedGas2).should.be.true();
        });
      });

      describe('Inefficient gas: sendMultiSigBatch vs batch', function () {
        let batcherInstance;
        let batcherOwner;

        before(async function () {
          wallet = await createWallet(accounts[0], [
            accounts[0],
            accounts[1],
            accounts[2]
          ]);
          const amount = web3.utils.toWei('200000', 'ether');
          await web3.eth.sendTransaction({ from: accounts[0], to: wallet.address, value: amount });

          batcherOwner = accounts[8];
          batcherInstance = await Batcher.new({ from: batcherOwner });
        });

        let sequenceId;
        beforeEach(async function () {
          sequenceId = parseInt(await wallet.getNextSequenceId.call());
        });

        it('Check sendMultiSigBatch Gas', async function () {
          for (let i = 0; i < 10; i++) {
            const params = {
              msgSenderAddress: accounts[0],
              otherSignerAddress: accounts[1],
              wallet,
              recipients: [accounts[5], accounts[6], accounts[7], accounts[8], accounts[9]],
              values: [6, 2, 1, 3, 5],
              expireTime: calculateFutureExpireTime(1200),
              sequenceId,
            };
            await sendMultiSigBatchTestHelper(params);
            sequenceId++;
          }
        });

        it('Check batch Gas', async () => {
          for (let i = 0; i < 10; i++) {
            const recipients = [accounts[5], accounts[6], accounts[7], accounts[8], accounts[9]];
            const values = [6, 2, 1, 3, 5];
            const totalValue = values.reduce((sum, elm) => sum + elm, 0);

            const iface = new ethers.utils.Interface([
                "function batch(address[] calldata recipients, uint256[] calldata values) payable"    
            ]);
            const data = iface.encodeFunctionData("batch", [recipients, values]);

            const params = {
              msgSenderAddress: accounts[0],
              otherSignerAddress: accounts[1],
              wallet,
              toAddress: batcherInstance.address,
              amount: totalValue,
              data,
              expireTime: calculateFutureExpireTime(1200),
              sequenceId
            };

            await sendMultiSigTestHelper(params);
            sequenceId++;
          }
        });
      });
    });
  }
);
