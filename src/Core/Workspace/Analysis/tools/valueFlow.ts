import { transactionReference } from '../../entityReferences';
import { toolGroups } from '../toolGroups';
import {
  choiceOption,
  defineTool,
  finding,
  formatAmount,
  isCoinbase,
  numberOption,
  referencedInputs,
  satoshiValue,
} from './shared';

export const valueFlowTool = defineTool({
  id: 'value-flow',
  name: 'Value flow and fees',
  group: toolGroups.valueAndStructure,
  displayOrder: 10,
  kind: 'observation',
  description:
    'Compare the bitcoin going into a transaction with the amount coming out. The difference is the transaction fee. This check shows the fee when enough information is available, flags fee rates at or above your chosen threshold, and points out missing or conflicting input details.',
  source: {
    title: 'BIP141: transaction virtual size',
    url: 'https://github.com/bitcoin/bips/blob/master/bip-0141.mediawiki',
  },
  parameters: [
    {
      id: 'feeMode',
      label: 'Show',
      type: 'select',
      defaultValue: 'all',
      choices: [
        { value: 'all', label: 'Every transaction' },
        { value: 'attention', label: 'Unknown fees or threshold reached' },
      ],
    },
    {
      id: 'highFeeRate',
      label: 'Review threshold (sat/vB)',
      type: 'number',
      defaultValue: 50,
      min: 0.1,
      max: 100000,
      step: 0.1,
      help: 'Your review threshold, not a recommended fee rate or network estimate.',
    },
  ],
  execute(context) {
    const mode = choiceOption(context.options, 'feeMode', 'all', ['all', 'attention']);
    const threshold = numberOption(context.options, 'highFeeRate', 50, 0.1, 100000, false);
    const findings = [];
    let complete = 0,
      missing = 0,
      inconsistent = 0,
      high = 0,
      coinbase = 0,
      noVsize = 0;
    for (const tx of context.transactions) {
      if (isCoinbase(tx)) {
        coinbase++;
        continue;
      }
      const inputs = referencedInputs(context.workspace, tx, context.prevouts);
      const absent = inputs.filter(
        (input) => input.resolution.status === 'missing' || input.resolution.status === 'conflict',
      );
      const evidence = [tx.txid, ...inputs.map((input) => input.txid)];
      if (absent.length || inputs.length !== tx.vin.length || !inputs.length) {
        missing++;
        findings.push(
          finding(
            context,
            'value-flow',
            tx.txid,
            'incomplete',
            absent.some((input) => input.resolution.status === 'conflict')
              ? 'Fee unknown: conflicting evidence'
              : 'Fee unknown: missing input data',
            `${inputs.length - absent.length}/${tx.vin.length} input values available. ${absent.some((input) => input.resolution.status === 'conflict') ? 'Conflicting observations need review before a fee can be calculated.' : 'Load missing data to calculate the fee.'} Unknown inputs are never zero.`,
            absent.length ? absent.map((input) => input.nodeId) : [transactionReference(tx.txid)],
            evidence,
            [tx.txid],
            undefined,
            {
              summary: absent.some((input) => input.resolution.status === 'conflict')
                ? 'The stored input records disagree, so a reliable fee cannot be calculated.'
                : 'Some input amounts are missing from this workspace. This does not mean anything is wrong with the transaction.',
              guidance: {
                kind: 'next-step',
                text: absent.some((input) => input.resolution.status === 'conflict')
                  ? 'Review the conflicting records before relying on a fee calculation. Loading more data will not replace conflicting evidence.'
                  : 'Load the missing amounts and run the check again. If your node cannot provide them, the fee will remain unknown.',
              },
            },
          ),
        );
        continue;
      }
      const inputAmounts = inputs.map((input) =>
        input.resolution.status === 'loaded' || input.resolution.status === 'attached'
          ? satoshiValue(input.resolution.output.value)
          : undefined,
      );
      const outputAmounts = tx.vout.map((output) => satoshiValue(output.value));
      if (
        !outputAmounts.length ||
        [...inputAmounts, ...outputAmounts].some((value) => value === undefined)
      ) {
        inconsistent++;
        findings.push(
          finding(
            context,
            'value-flow',
            tx.txid,
            'incomplete',
            'Value data cannot be reconciled',
            'An amount is invalid or outputs are unavailable. Refresh the affected transaction before reviewing its fee.',
            [transactionReference(tx.txid)],
            evidence,
            [tx.txid],
            undefined,
            {
              summary:
                'Some amounts are invalid or missing, so this workspace cannot calculate a reliable fee.',
              guidance: {
                kind: 'next-step',
                text: 'Review and refresh the affected transaction. This describes a problem with the available records, not proof of an invalid Bitcoin transaction.',
              },
            },
          ),
        );
        continue;
      }
      const inputTotal = inputAmounts.reduce<bigint>((sum, value) => sum + value!, 0n);
      const outputTotal = outputAmounts.reduce<bigint>((sum, value) => sum + value!, 0n);
      const fee = inputTotal - outputTotal;
      if (fee < 0n) {
        inconsistent++;
        findings.push(
          finding(
            context,
            'value-flow',
            tx.txid,
            'incomplete',
            'Inconsistent values: outputs exceed inputs',
            `Known inputs total ${formatAmount(inputTotal)}; outputs total ${formatAmount(outputTotal)}. These records disagree. Refresh the affected transaction before reviewing its fee.`,
            [transactionReference(tx.txid)],
            evidence,
            [tx.txid],
            undefined,
            {
              summary:
                'The stored records show more bitcoin leaving than entering the transaction. These amounts cannot support a valid fee calculation.',
              guidance: {
                kind: 'next-step',
                text: 'Review the input amounts and refresh the affected records before relying on the totals.',
              },
            },
          ),
        );
        continue;
      }
      complete++;
      const rate =
        Number.isSafeInteger(tx.vsize) && tx.vsize! > 0 && fee <= BigInt(Number.MAX_SAFE_INTEGER)
          ? Number(fee) / tx.vsize!
          : undefined;
      if (rate === undefined) noVsize++;
      const exceeds = rate !== undefined && rate >= threshold;
      if (exceeds) high++;
      if (mode === 'attention' && !exceeds && rate !== undefined) continue;
      findings.push(
        finding(
          context,
          'value-flow',
          tx.txid,
          'observation',
          `${exceeds ? 'Fee threshold reached' : 'Network fee'}: ${formatAmount(fee)}`,
          `Known inputs total ${formatAmount(inputTotal)}; outputs total ${formatAmount(outputTotal)}. The difference is the fee. ${rate === undefined ? 'Fee rate is unknown because virtual size is unavailable.' : `Fee rate: ${rate.toLocaleString('en-US', { maximumFractionDigits: 2 })} sat/vB (${tx.vsize} vB).`}${exceeds ? ` This meets your ${threshold} sat/vB review threshold; it does not establish overpayment at the time.` : ''}`,
          [transactionReference(tx.txid)],
          evidence,
          [tx.txid],
          exceeds ? 'fee-threshold' : undefined,
          {
            summary: [
              fee > outputTotal
                ? `The fee is larger than the ${formatAmount(outputTotal)} left after the fee. This can make small transfers relatively expensive.`
                : `This transaction allocates ${formatAmount(fee)} to the network fee.`,
              exceeds
                ? `Its fee rate meets your ${threshold} sat/vB review threshold. Whether it was expensive depends on network demand when it was sent.`
                : rate === undefined
                  ? 'The fee rate cannot be calculated because transaction size is unavailable.'
                  : `The fee rate is ${rate.toLocaleString('en-US', { maximumFractionDigits: 2 })} sat/vB, below your review threshold.`,
            ].join(' '),
            guidance: {
              kind: 'tip',
              text:
                fee > outputTotal
                  ? 'Fees depend on transaction size and the chosen fee rate. Before sending a small amount, check how much of your total cost will be fees.'
                  : 'Compare your wallet’s fee options before sending. If the transfer can wait, a slower option may cost less.',
            },
          },
        ),
      );
    }
    return {
      findings,
      summary: `${complete} transactions reconciled; ${missing} have missing input data; ${inconsistent} have inconsistent data.`,
      emptyReason:
        mode === 'attention'
          ? 'Every eligible transaction has complete fee data below your review threshold, or the scope contains only coinbase transactions.'
          : 'No non-coinbase transactions are in this scope.',
      stats: [
        { label: 'Reconciled transactions', value: complete },
        { label: 'Missing input data', value: missing },
        { label: 'Inconsistent values', value: inconsistent },
        { label: 'At or above threshold', value: high },
        { label: 'Fee rate unavailable', value: noVsize },
        { label: 'Coinbase skipped', value: coinbase },
      ],
    };
  },
});
