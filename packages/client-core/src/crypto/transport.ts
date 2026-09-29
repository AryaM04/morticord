// The network side of the crypto layer: the key server routes, the
// to-device route and the TO_DEVICE_ACK gateway op. Tests use a fake in
// place of the HTTP one.
import {
  GatewayOpcode,
  claimKeysResponseSchema,
  queryKeysResponseSchema,
  sendToDeviceResponseSchema,
  uploadKeysResponseSchema,
  type ClaimKeysResponse,
  type DeviceRef,
  type PutMasterKeyRequest,
  type QueryKeysResponse,
  type SendToDeviceResponse,
  type ToDeviceMessage,
  type UploadKeysRequest,
  type UploadKeysResponse,
} from "@discord-clone/shared";
import type { ApiClient } from "../api.js";

export interface CryptoTransport {
  uploadKeys(body: UploadKeysRequest): Promise<UploadKeysResponse>;
  putMasterKey(body: PutMasterKeyRequest): Promise<void>;
  queryKeys(userIds: string[]): Promise<QueryKeysResponse>;
  claimKeys(devices: DeviceRef[]): Promise<ClaimKeysResponse>;
  sendToDevice(messages: ToDeviceMessage[]): Promise<SendToDeviceResponse>;
  /** Send TO_DEVICE_ACK over the gateway. It does nothing while the gateway is down. */
  ackToDevice(upToId: string, resync: boolean): void;
}

export function createHttpCryptoTransport(
  api: ApiClient,
  gatewaySend: (op: number, d?: unknown) => void,
): CryptoTransport {
  return {
    uploadKeys: (body) => api.request("POST", "/keys/upload", { body, schema: uploadKeysResponseSchema }),
    putMasterKey: (body) => api.request("PUT", "/keys/master", { body }),
    queryKeys: (userIds) => api.request("POST", "/keys/query", { body: { userIds }, schema: queryKeysResponseSchema }),
    claimKeys: (devices) => api.request("POST", "/keys/claim", { body: { devices }, schema: claimKeysResponseSchema }),
    sendToDevice: (messages) =>
      api.request("POST", "/to-device", { body: { messages }, schema: sendToDeviceResponseSchema }),
    ackToDevice: (upToId, resync) => gatewaySend(GatewayOpcode.TO_DEVICE_ACK, { upToId, ...(resync ? { resync } : {}) }),
  };
}
