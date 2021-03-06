/* tslint:disable */
import {
  WriteResult,
} from '.';

/**
 * The response for Firestore.Write.
 */
export interface WriteResponse {
  commitTime: string;  // The time at which the commit occurred.
  streamId: string;  // The ID of the stream.Only set on the first message, when a new stream was created.
  streamToken: string;  // A token that represents the position of this response in the stream.This can be used by a client to resume the stream at this point.This field is always set.
  writeResults: WriteResult[];  // The result of applying the writes.This i-th write result corresponds to the i-th write in therequest.
}
