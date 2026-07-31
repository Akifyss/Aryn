import type { JsonLineProcess } from '../../../json-line-process'
import type { SessionRuntimeLease } from '../../runtime/session-runtime-coordinator'
import type {
  JsonRecord,
  PiCliSessionRecord,
  PiRpcModel,
} from './session-model'

/** Mutable state owned by one native PI CLI RPC process. */
export type PiCliRuntime = {
  isStreaming: boolean
  lease: SessionRuntimeLease
  models: PiRpcModel[]
  process: JsonLineProcess
  record: PiCliSessionRecord
  state: JsonRecord
}
