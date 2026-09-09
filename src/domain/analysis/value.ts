import { outputNodeId, txNodeId } from '../types';
import { analysisScriptType } from './scripts';
import {
  choiceOption,
  defineTool,
  finding,
  formatAmount,
  isCoinbase,
  numberOption,
  referencedInputs,
  satoshiValue,
  spendableOutputs,
} from './shared';

export const valueFlowTool = defineTool({
  id: 'value-flow',
  name: 'Value flow and fees',
  group: 'Value and structure',
  kind: 'observation',
  description:
    'Reconcile input and output amounts using known previous-output details. Reveal missing evidence and review fees against your own threshold.',
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
            absent.length ? absent.map((input) => input.nodeId) : [txNodeId(tx.txid)],
            evidence,
            [tx.txid],
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
            [txNodeId(tx.txid)],
            evidence,
            [tx.txid],
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
            [txNodeId(tx.txid)],
            evidence,
            [tx.txid],
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
          `${exceeds ? 'Fee threshold reached' : 'Fee'}: ${formatAmount(fee)}`,
          `Known inputs total ${formatAmount(inputTotal)}; outputs total ${formatAmount(outputTotal)}. The difference is the fee. ${rate === undefined ? 'Fee rate is unknown because virtual size is unavailable.' : `Fee rate: ${rate.toLocaleString('en-US', { maximumFractionDigits: 2 })} sat/vB (${tx.vsize} vB).`}${exceeds ? ` This meets your ${threshold} sat/vB review threshold; it does not establish overpayment at the time.` : ''}`,
          [txNodeId(tx.txid)],
          evidence,
          [tx.txid],
          exceeds ? 'fee-threshold' : undefined,
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

export const structureTool = defineTool({
  id: 'transaction-shapes',
  name: 'Consolidation and fan-out',
  group: 'Value and structure',
  kind: 'observation',
  description:
    'Find many-input, few-output shapes or transactions distributing value to many outputs. Tune the thresholds for your investigation.',
  source: {
    title: 'Bitcoin transaction structure',
    url: 'https://developer.bitcoin.org/devguide/transactions.html',
  },
  parameters: [
    {
      id: 'minInputs',
      label: 'Consolidation: minimum inputs',
      type: 'number',
      defaultValue: 5,
      min: 2,
      max: 1000,
    },
    {
      id: 'maxConsolidationOutputs',
      label: 'Consolidation: maximum outputs',
      type: 'number',
      defaultValue: 2,
      min: 1,
      max: 100,
    },
    {
      id: 'minOutputs',
      label: 'Fan-out: minimum outputs',
      type: 'number',
      defaultValue: 5,
      min: 2,
      max: 1000,
    },
    {
      id: 'fanoutRatio',
      label: 'Fan-out: outputs per input',
      type: 'number',
      defaultValue: 3,
      min: 1.1,
      max: 100,
      step: 0.1,
    },
  ],
  execute(context) {
    const minInputs = numberOption(context.options, 'minInputs', 5, 2, 1000);
    const maxOutputs = numberOption(context.options, 'maxConsolidationOutputs', 2, 1, 100);
    const minOutputs = numberOption(context.options, 'minOutputs', 5, 2, 1000);
    const ratio = numberOption(context.options, 'fanoutRatio', 3, 1.1, 100, false);
    const findings = [];
    let consolidations = 0,
      fanouts = 0,
      coinbase = 0;
    for (const tx of context.transactions) {
      if (isCoinbase(tx)) {
        coinbase++;
        continue;
      }
      const outputs = spendableOutputs(tx),
        inputCount = tx.vin.length;
      const consolidation =
        inputCount >= minInputs &&
        outputs.length > 0 &&
        outputs.length <= maxOutputs &&
        inputCount > outputs.length;
      const fanout =
        inputCount > 0 && outputs.length >= minOutputs && outputs.length / inputCount >= ratio;
      if (!consolidation && !fanout) continue;
      if (consolidation) consolidations++;
      else fanouts++;
      findings.push(
        finding(
          context,
          'transaction-shapes',
          tx.txid,
          'observation',
          `${consolidation ? 'Consolidation-shaped' : 'Fan-out'}: ${inputCount} input${inputCount === 1 ? '' : 's'}, ${outputs.length} spendable output${outputs.length === 1 ? '' : 's'}`,
          `${consolidation ? `At least ${minInputs} inputs and at most ${maxOutputs} spendable outputs, with more inputs than outputs.` : `At least ${minOutputs} spendable outputs and ${ratio} outputs per input.`} ${tx.vout.length - outputs.length} data outputs were omitted from the shape count. Batching, collaborative payments and other workflows can share this structure; the shape does not establish purpose or ownership. Inspect the input and output paths.`,
          [
            txNodeId(tx.txid),
            ...referencedInputs(context.workspace, tx, context.prevouts).map(
              (input) => input.nodeId,
            ),
            ...outputs.map((output) => outputNodeId(tx.txid, output.n)),
          ],
          [tx.txid],
        ),
      );
    }
    return {
      findings,
      summary: `${consolidations} consolidation-shaped and ${fanouts} fan-out transactions match your thresholds.`,
      emptyReason:
        'No transaction in this scope meets the configured input/output thresholds. Data outputs and coinbase transactions are excluded.',
      stats: [
        { label: 'Consolidation-shaped', value: consolidations },
        { label: 'Fan-out', value: fanouts },
        { label: 'Coinbase skipped', value: coinbase },
      ],
    };
  },
});

export const scriptTool = defineTool({
  id: 'script-types',
  name: 'Script-type comparisons',
  group: 'Value and structure',
  kind: 'observation',
  description:
    'Compare reported types or standard types decoded from loaded script hex. Highlight mixed types and differences without guessing which output is change.',
  source: {
    title: 'BIP78: limitations of script-type heuristics',
    url: 'https://github.com/bitcoin/bips/blob/master/bip-0078.mediawiki',
  },
  parameters: [
    {
      id: 'scriptMode',
      label: 'Compare',
      type: 'select',
      defaultValue: 'inputs-and-outputs',
      choices: [
        { value: 'inputs-and-outputs', label: 'Inputs and outputs' },
        { value: 'outputs', label: 'Outputs only' },
      ],
    },
  ],
  execute(context) {
    const mode = choiceOption(context.options, 'scriptMode', 'inputs-and-outputs', [
      'inputs-and-outputs',
      'outputs',
    ]);
    const findings = [];
    let unknownInputs = 0,
      unknownOutputs = 0;
    for (const tx of context.transactions) {
      const inputs =
        mode === 'outputs' || isCoinbase(tx)
          ? []
          : referencedInputs(context.workspace, tx, context.prevouts);
      const outputs = spendableOutputs(tx);
      const inputTypes = new Set(
        inputs
          .map((input) =>
            input.resolution.status === 'loaded' || input.resolution.status === 'attached'
              ? analysisScriptType(input.resolution.output)
              : undefined,
          )
          .filter(Boolean),
      );
      const outputTypes = new Set(
        outputs.map((output) => analysisScriptType(output)).filter(Boolean),
      );
      const missingInputs =
        inputs.filter(
          (input) =>
            (input.resolution.status !== 'loaded' && input.resolution.status !== 'attached') ||
            !analysisScriptType(input.resolution.output),
        ).length + (mode === 'outputs' || isCoinbase(tx) ? 0 : tx.vin.length - inputs.length);
      const missingOutputs = outputs.filter((output) => !analysisScriptType(output)).length;
      unknownInputs += missingInputs;
      unknownOutputs += missingOutputs;
      const difference =
        inputTypes.size === 1 &&
        outputTypes.size === 1 &&
        [...inputTypes][0] !== [...outputTypes][0];
      const partial = missingInputs > 0 || missingOutputs > 0;
      if (inputTypes.size < 2 && outputTypes.size < 2 && !difference && !partial) continue;
      const title =
        outputTypes.size > 1
          ? 'Mixed output script types'
          : inputTypes.size > 1
            ? 'Mixed input script types'
            : difference
              ? 'Known input and output script types differ'
              : 'Script comparison incomplete';
      findings.push(
        finding(
          context,
          'script-types',
          tx.txid,
          partial ? 'incomplete' : 'observation',
          partial && title !== 'Script comparison incomplete' ? `${title} (partial data)` : title,
          `${mode === 'outputs' ? 'Input scripts were not compared.' : `Known input types: ${[...inputTypes].sort().join(', ') || 'none'}.`} Known output types: ${[...outputTypes].sort().join(', ') || 'none'}.${partial ? ` ${missingInputs} input and ${missingOutputs} output types are unavailable or unrecognized.` : ''} Different script types can be normal. They do not identify change or owners. Inspect the linked outputs for context.`,
          [
            txNodeId(tx.txid),
            ...inputs
              .filter(
                (input) =>
                  partial ||
                  ((input.resolution.status === 'loaded' ||
                    input.resolution.status === 'attached') &&
                    analysisScriptType(input.resolution.output)),
              )
              .map((input) => input.nodeId),
            ...outputs
              .filter((output) => partial || analysisScriptType(output))
              .map((output) => outputNodeId(tx.txid, output.n)),
          ],
          [
            tx.txid,
            ...inputs
              .filter(
                (input) =>
                  input.resolution.status === 'loaded' || input.resolution.status === 'attached',
              )
              .map((input) => input.txid),
          ],
          [tx.txid],
        ),
      );
    }
    return {
      findings,
      summary: `${findings.length} script comparisons found; ${unknownInputs} input and ${unknownOutputs} output types are unavailable or unrecognized.`,
      emptyReason:
        'No mixed known types or known input/output type differences were found. Missing script types cannot establish a match or a difference.',
      stats: [
        { label: 'Transactions compared', value: context.transactions.length },
        { label: 'Unavailable input types', value: unknownInputs },
        { label: 'Unavailable output types', value: unknownOutputs },
      ],
    };
  },
});
