import * as anchor from '@project-serum/anchor';
import FormData from 'form-data';
import fs from 'fs';
import log from 'loglevel';
import fetch from 'node-fetch';
import { ARWEAVE_PAYMENT_WALLET } from '../constants';
import { sendTransactionWithRetryWithKeypair } from '../transactions';
import { getAssetCostToStore, ARWEAVE_UPLOAD_ENDPOINT } from '@oyster/common';
import { stat } from 'fs/promises';

async function upload(data: FormData, manifest, index) {
  log.debug(`trying to upload ${index}.png: ${manifest.name}`);
  return await (
    await fetch(ARWEAVE_UPLOAD_ENDPOINT, {
      method: 'POST',
      // @ts-ignore
      body: data,
    })
  ).json();
}

export async function arweaveUpload(
  walletKeyPair,
  anchorProgram,
  env,
  image,
  manifestBuffer,
  manifest,
  index,
) {
  const fsStat = await stat(image);
  const storageCost = await getAssetCostToStore([{ size: fsStat.size }]);
  console.log(`storage cost of ${image}: ${storageCost}`);

  const instructions = [
    anchor.web3.SystemProgram.transfer({
      fromPubkey: walletKeyPair.publicKey,
      toPubkey: ARWEAVE_PAYMENT_WALLET,
      lamports: storageCost,
    }),
  ];

  const tx = await sendTransactionWithRetryWithKeypair(
    anchorProgram.provider.connection,
    walletKeyPair,
    instructions,
    [],
    'single',
  );
  log.debug('transaction for arweave payment:', tx);

  const data = new FormData();
  data.append('transaction', tx['txid']);
  data.append('env', env);
  data.append('file[]', fs.createReadStream(image), {
    filename: `image.png`,
    contentType: 'image/png',
  });
  data.append('file[]', manifestBuffer, 'metadata.json');

  const result = await upload(data, manifest, index);

  const metadataFile = result.messages?.find(
    m => m.filename === 'manifest.json',
  );
  if (metadataFile?.transactionId) {
    const link = `https://arweave.net/${metadataFile.transactionId}`;
    log.debug(`File uploaded: ${link}`);
    return link;
  } else {
    // @todo improve
    throw new Error(`No transaction ID for upload: ${index}`);
  }
}
