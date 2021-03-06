/* tslint:disable */
import {
  Status,
} from '.';

/**
 * This resource represents a long-running operation that is the result of a
 * network API call.
 */
export interface Operation {
  done: boolean;  // If the value is `false`, it means the operation is still in progress.If `true`, the operation is completed, and either `error` or `response` isavailable.
  error: Status;  // The error result of the operation in case of failure or cancellation.
  metadata: { [key: string]: any };  // Service-specific metadata associated with the operation.  It typicallycontains progress information and common metadata such as create time.Some services might not provide such metadata.  Any method that returns along-running operation should document the metadata type, if any.
  name: string;  // The server-assigned name, which is only unique within the same service thatoriginally returns it. If you use the default HTTP mapping, the`name` should have the format of `operations/some/unique/name`.
  response: { [key: string]: any };  // The normal response of the operation in case of success.  If the originalmethod returns no data on success, such as `Delete`, the response is`google.protobuf.Empty`.  If the original method is standard`Get`/`Create`/`Update`, the response should be the resource.  For othermethods, the response should have the type `XxxResponse`, where `Xxx`is the original method name.  For example, if the original method nameis `TakeSnapshot()`, the inferred response type is`TakeSnapshotResponse`.
}
