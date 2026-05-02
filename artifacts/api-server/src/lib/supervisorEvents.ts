import { EventEmitter } from "events";

export interface SupervisorEvent {
  type: "message" | "call_start" | "call_end" | "escalation";
  callId: string;
  callSid: string;
  fromNumber?: string;
  toNumber?: string;
  direction?: string;
  role?: "user" | "assistant";
  content?: string;
  timestamp: string;
}

class SupervisorEventEmitter extends EventEmitter {}

export const supervisorEvents = new SupervisorEventEmitter();
supervisorEvents.setMaxListeners(200);
