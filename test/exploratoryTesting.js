require('assert');
const should = require('should');
const _ = require('lodash');
const hre = require('hardhat');
const helpers = require('./helpers');
const {
  calculateFutureExpireTime,
  createWalletHelper,
} = require('./wallet/helpers');
const { privateKeyForAccount } = require('./helpers');
const util = require('ethereumjs-util');
const EthWalletSimple = artifacts.require('./WalletSimple.sol');
const Fail = artifacts.require('./Fail.sol');
const GasGuzzler = artifacts.require('./GasGuzzler.sol');
const GasHeavy = artifacts.require('./GasHeavy.sol');
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

        await params.wallet.sendMultiSig(
          msgSenderArgs.toAddress.toLowerCase(),
          web3.utils.toWei(web3.utils.toBN(msgSenderArgs.amount), 'ether'),
          util.addHexPrefix(msgSenderArgs.data),
          msgSenderArgs.expireTime,
          msgSenderArgs.sequenceId,
          helpers.serializeSignature(sig),
          { from: params.msgSenderAddress }
        );
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
          { from: params.msgSenderAddress }
        );
      };

      describe('sendMultiSigBatch vs batch', function () {
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

          failInstance = await Fail.new();
          gasGuzzlerInstance = await GasGuzzler.new();
          gasHeavyInstance = await GasHeavy.new();
        });

        let sequenceId;
        beforeEach(async function () {
          sequenceId = parseInt(await wallet.getNextSequenceId.call());
        });

        it('Check sendMultiSigBatch Gas', async function () {
          sequenceId = 1001;
          for (let i = 0; i < 100; i++) {
            const params = {
              msgSenderAddress: accounts[0],
              otherSignerAddress: accounts[1],
              wallet: wallet,
              recipients: [accounts[5], accounts[6], accounts[7], accounts[8], accounts[9]],
              values: [6, 2, 1, 3, 5],
              expireTime: calculateFutureExpireTime(1200),
              sequenceId: sequenceId
            };
            await sendMultiSigBatchTestHelper(params);
            sequenceId++;
          }
        });

        it('Check batch Gas', async () => {
          for (let i = 0; i < 100; i++) {
            const recipients = [accounts[5], accounts[6], accounts[7], accounts[8], accounts[9]];
            const values = [6, 2, 1, 3, 5];
            const totalValue = values.reduce((sum, elm) => sum + elm, 0);

            const iface = new ethers.utils.Interface([
                "function batch(address[] calldata recipients, uint256[] calldata values) payable"    
            ])
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
            usedSequenceId = sequenceId;
            sequenceId++;
          }
        });
      });
    });
  }
);
