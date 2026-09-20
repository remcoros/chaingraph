import { outpointReference, transactionReference } from '../../entityReferences';
import { toolGroups } from '../toolGroups';
import { analysisScriptType } from './scripts';
import {
  choiceOption,
  defineTool,
  finding,
  isCoinbase,
  referencedInputs,
  spendableOutputs,
} from './shared';

export const scriptTool = defineTool({
  id: 'script-types',
  name: 'Script-type comparisons',
  group: toolGroups.valueAndStructure,
  displayOrder: 30,
  kind: 'observation',
  description:
    'Compare the types of spending rules used by a transaction’s inputs and outputs, such as legacy, SegWit and Taproot. This helps you spot changes in how coins are held. A different type can be a clue to investigate, but it does not establish which output is change.',
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
            transactionReference(tx.txid),
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
              .map((output) => outpointReference(tx.txid, output.n)),
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
          [transactionReference(tx.txid)],
          [tx.txid],
          undefined,
          {
            summary: partial
              ? 'Some script types are missing, unrecognized or conflicting, so this comparison is incomplete. A script defines how an output can be spent.'
              : 'This transaction uses different script types: the rules for spending its outputs. That can reflect different address formats and normal wallet behavior.',
            guidance: partial
              ? {
                  kind: 'next-step',
                  text: 'Load missing input data when available. If the script bytes are already present, this check may not recognize their type; another lookup will not help.',
                }
              : {
                  kind: 'tip',
                  text: 'A different address format does not identify a recipient or prove which output is change. Use your wallet records and labels to understand the transaction.',
                },
          },
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
