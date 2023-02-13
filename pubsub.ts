
import { nrp } from "./data";
import { StreamMessage } from "./proto/randomPackage/StreamMessage";
import { User } from "./proto/randomPackage/User";

// keys for emitter & receiver channels
const REDIS_CHANNELS = {
  mainRoom: "MAIN_ROOM",
  userChange: "USER_CHAHNGE",
};

// create a publishing/emitting event for the main room
const emitMainRoomChatUpdate = (msg: StreamMessage) =>
  // a streamed message to the main room
  nrp.emit(REDIS_CHANNELS.mainRoom, JSON.stringify(msg));

// listen to updates to the main room and invoke a passed in callback
const listenMainRoomChatUpdate = (
  fn: (data: string, channel: string) => void
) => nrp.on(REDIS_CHANNELS.mainRoom, fn);

const emitUserUpdateEvent = (user: User) =>
  nrp.emit(REDIS_CHANNELS.userChange, JSON.stringify(user));

const listenUserUpdateEvent = (fn: (data: string, channel: string) => void) =>
  nrp.on(REDIS_CHANNELS.userChange, fn);

export {
  emitMainRoomChatUpdate,
  listenMainRoomChatUpdate,
  emitUserUpdateEvent,
  listenUserUpdateEvent,
};
