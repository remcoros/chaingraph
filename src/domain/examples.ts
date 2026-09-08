export interface CuratedExample {
  id: string;
  network: 'testnet4';
  title: string;
  description: string;
  txid: string;
  vout?: number;
  verifiedAt: string;
  sources: readonly { title: string; url: string }[];
  evidence: {
    inputCount: number;
    outputCount: number;
    address: string;
    historyCount: number;
    funding: readonly { txid: string; vout: number }[];
    spending: readonly { txid: string; vin: number }[];
  };
}

/** Public chain examples, verified through Core and Fulcrum. No ownership labels. */
export const TESTNET4_EXAMPLES: readonly CuratedExample[] = [
  {
    id: 'spent-output-path',
    network: 'testnet4',
    title: 'Follow a spent output',
    description:
      'One input and two outputs. Start at output 1, then follow its funding and confirmed spending paths.',
    txid: 'd4e564d295233f62603f7a7e9527acf88f6e467985868f15339887285d64bb1a',
    vout: 1,
    verifiedAt: '2026-09-07T23:41:27.848Z',
    sources: [
      {
        title: 'Transaction on mempool.space',
        url: 'https://mempool.space/testnet4/tx/d4e564d295233f62603f7a7e9527acf88f6e467985868f15339887285d64bb1a',
      },
      {
        title: 'Spending transaction on mempool.space',
        url: 'https://mempool.space/testnet4/tx/8cfd7566b77a32519b7f9054c879ce73628255fb6171e431ba5134c114cd1044',
      },
    ],
    evidence: {
      inputCount: 1,
      outputCount: 2,
      address: 'tb1qwdzfjrteqc20r4sf5c59hyhm28ncj9366ch7q5',
      historyCount: 2,
      funding: [
        { txid: '0ffaf73db54ae2666a19324415fb158993b7b30478237ec56d655cfbed2bf606', vout: 0 },
      ],
      spending: [
        { txid: '8cfd7566b77a32519b7f9054c879ce73628255fb6171e431ba5134c114cd1044', vin: 0 },
      ],
    },
  },
  {
    id: 'two-inputs-mixed-outputs',
    network: 'testnet4',
    title: 'Inspect two inputs and mixed scripts',
    description:
      'Two inputs fund three outputs, including a data output. Compare the scripts and try a tentative common-input grouping.',
    txid: 'b92eb2d8abf81a25197bacde9845eea3d711bd6edf25e1e8975d731271dd83eb',
    vout: 0,
    verifiedAt: '2026-09-07T23:41:27.848Z',
    sources: [
      {
        title: 'Transaction on mempool.space',
        url: 'https://mempool.space/testnet4/tx/b92eb2d8abf81a25197bacde9845eea3d711bd6edf25e1e8975d731271dd83eb',
      },
      {
        title: 'Spending transaction on mempool.space',
        url: 'https://mempool.space/testnet4/tx/e0d797ca417b3c39e64677da7be5591f7c5e5d945743e9046efdbb10fd8ba76f',
      },
    ],
    evidence: {
      inputCount: 2,
      outputCount: 3,
      address: 'tb1qk3endeq6x0xj4pjt4zwag8wf3a629rzqr8jxd7jnmlac902wa5ysqxm9wt',
      historyCount: 8,
      funding: [
        { txid: '4289097ca8ad4f63484b8e278fba5789ee2decbe453e988934c7f9dfe9537ed8', vout: 0 },
        { txid: '02ae1e8cfba4f63165fa9f9abd8a446f44cb87f69dedea90015658e4861a3359', vout: 0 },
      ],
      spending: [
        { txid: 'e0d797ca417b3c39e64677da7be5591f7c5e5d945743e9046efdbb10fd8ba76f', vin: 0 },
      ],
    },
  },
  {
    id: 'fifty-three-output-fanout',
    network: 'testnet4',
    title: 'Explore a 53-output fan-out',
    description:
      'One input fans out to 53 outputs, including a data output. Start at output 0 and expand one path at a time.',
    txid: 'cc159432ffb7a166abeccc79800e9616a09ea9ac6937080c2ca37b38671970e5',
    vout: 0,
    verifiedAt: '2026-09-07T23:41:27.848Z',
    sources: [
      {
        title: 'Transaction on mempool.space',
        url: 'https://mempool.space/testnet4/tx/cc159432ffb7a166abeccc79800e9616a09ea9ac6937080c2ca37b38671970e5',
      },
      {
        title: 'Public address discovery source',
        url: 'https://mempool.space/testnet4/address/tb1qzsjnew5qcn75e4cqdsc6r9v8fjy5ensancqmv2l2n82p0q5f5tls758l9d',
      },
      {
        title: 'Spending transaction on mempool.space',
        url: 'https://mempool.space/testnet4/tx/647cfdf953d2548ad7d60f8079a015b5c667e4a7aaa8da12b857216e579e9769',
      },
    ],
    evidence: {
      inputCount: 1,
      outputCount: 53,
      address: 'tb1qzsjnew5qcn75e4cqdsc6r9v8fjy5ensancqmv2l2n82p0q5f5tls758l9d',
      historyCount: 13,
      funding: [
        { txid: '1ad34d66983985c886103e2bb765a5fb3076f7fb344f7732534e89163655e9dc', vout: 0 },
      ],
      spending: [
        { txid: '647cfdf953d2548ad7d60f8079a015b5c667e4a7aaa8da12b857216e579e9769', vin: 0 },
      ],
    },
  },
];
