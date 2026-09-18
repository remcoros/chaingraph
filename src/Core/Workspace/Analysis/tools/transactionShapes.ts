import { outpointReference, transactionReference } from '../../entityReferences';
import { toolGroups } from '../toolGroups';
import {
  defineTool,
  finding,
  isCoinbase,
  numberOption,
  referencedInputs,
  spendableOutputs,
} from './shared';

export const structureTool = defineTool({
  id: 'transaction-shapes',
  name: 'Consolidation and fan-out',
  group: toolGroups.valueAndStructure,
  displayOrder: 20,
  kind: 'observation',
  description:
    'Find transactions that gather many previously received amounts into a few new outputs, or split bitcoin across many outputs. These patterns can help you spot coin consolidation or payments made in batches, though the transaction alone cannot tell you its purpose or how many people were involved.',
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
          consolidation
            ? `${inputCount} amounts spent together`
            : `${outputs.length} outputs created in one transaction`,
          `${consolidation ? `At least ${minInputs} inputs and at most ${maxOutputs} spendable outputs, with more inputs than outputs.` : `At least ${minOutputs} spendable outputs and ${ratio} outputs per input.`} ${tx.vout.length - outputs.length} data outputs were omitted from the shape count. Batching, collaborative payments and other workflows can share this structure; the shape does not establish purpose or ownership. Inspect the input and output paths.`,
          [
            transactionReference(tx.txid),
            ...referencedInputs(context.workspace, tx, context.prevouts).map(
              (input) => input.nodeId,
            ),
            ...outputs.map((output) => outpointReference(tx.txid, output.n)),
          ],
          [tx.txid],
          [tx.txid],
          undefined,
          {
            summary: consolidation
              ? `This transaction combines ${inputCount} previously received amounts into ${outputs.length} new output${outputs.length === 1 ? '' : 's'}. This shape is often used to gather smaller amounts together, but it does not prove they belong to one wallet.`
              : `This transaction creates ${outputs.length} spendable outputs. It may combine several payments in one transaction; the output count does not tell us how many people were paid.`,
            guidance: consolidation
              ? {
                  kind: 'privacy',
                  text: 'Combining coins in one ordinary transaction creates a public connection between them. Use labels and your wallet’s coin control if you want to keep different sources separate.',
                }
              : {
                  kind: 'tip',
                  text: 'An output may be a payment or change returned to a wallet. Compare your wallet records and labels before treating each output as a separate recipient.',
                },
          },
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
