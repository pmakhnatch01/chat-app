import path from "path";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { ProtoGrpcType } from "./proto/random";
import { RandomHandlers } from "./proto/randomPackage/Random";
import { StreamMessage } from "./proto/randomPackage/StreamMessage";
import { ChatConnectRequest } from "./proto/randomPackage/ChatConnectRequest";
import { UserStreamResponse } from "./proto/randomPackage/UserStreamResponse";
import { User } from "./proto/randomPackage/User";
import {
  addUser,
  listUsers,
  listMessagesFromMainRoom,
  addChatToMainRoom,
  findUser,
  updateUser,
} from "./data";
import {
  emitMainRoomChatUpdate,
  emitUserUpdateEvent,
  listenMainRoomChatUpdate,
  listenUserUpdateEvent,
} from "./pubsub";
import { Status } from "./proto/randomPackage/Status";

const PORT = 9090;
const PROTO_FILE = "./proto/random.proto";

const packageDef = protoLoader.loadSync(path.resolve(__dirname, PROTO_FILE));
const grpcObj = grpc.loadPackageDefinition(
  packageDef
) as unknown as ProtoGrpcType;
const randomPackage = grpcObj.randomPackage;

// start a gRPC server
function main() {
  const server = getServer();
  server.bindAsync(
    `0.0.0.0:${PORT}`,
    grpc.ServerCredentials.createInsecure(),
    (err, port) => {
      if (err) {
        console.error(err);
        return;
      }
      console.log(`Your server as started on port ${port}`);
      server.start();
    }
  );
  // right as the server starts, create Chat Update listener and User Update listener
  runStreams();
}

// stores message stream state per user id
const userIdToMsgStream = new Map <number, grpc.ServerWritableStream<ChatConnectRequest, StreamMessage>> ();
// stores user list state stream per user id
const userIdToUserListStream = new Map<number, grpc.ServerWritableStream<ChatConnectRequest, UserStreamResponse>> ();

// create a gRPC server
function getServer() {
  const server = new grpc.Server();
  server.addService(randomPackage.Random.service, {
    ChatInitiate: (call, callback) => {
      // create a sessionName for the user creating a chat and record their avatar
      const sessionName = (call.request.name || "").trim().toLowerCase();
      const avatar = call.request.avatarUrl || "";

      // check if the client hasn't passed in user name and/or avatar
      if (!sessionName || !avatar)
        callback(new Error("Name/Avatar is required"));
      
      // invoke listUsers with the callback that is going to be invoked on USERS array we'll get in the process
      listUsers((err, users) => {
        if (err) return callback(err);
        // finds id of the user requesting a chat session. Note, Short Circuiting in case "users" is an empty array
        let idx = users.findIndex((u) => u?.name?.toLowerCase() === sessionName); 
        // check if such user exists and they are online
        if (idx !== -1 && users[idx].status === Status.ONLINE)
          return callback(new Error("User with name already exist"));
        // if they exist but NOT online, bring them online
        if (idx !== -1) {
          const user = users[idx];
          user.status = Status.ONLINE;
          // update user's status from offline to online
          updateUser(user, (err) => {
            if (err) return callback(err);
            emitUserUpdateEvent(user)
            return callback(null, { id: user.id });
          });
          // return said user's ID to the client
        } else {
          // if such user doesn't exist, create a new user with ONLINE status
          const user: User = {
            id: idx === -1 ? Math.floor(Math.random() * 10000000) : idx,
            name: sessionName,
            avatar,
            status: Status.ONLINE,
          };
          // add user to the DB
          addUser(user, (err) => {
            if (err) return callback(err);
            emitUserUpdateEvent(user);
            // return said user's ID to the client
            return callback(null, { id: user.id });
          });
        }
      });
    },
    // stream messages by a specific user to the chat; call object. Note, this doesn't have a callback
    ChatStream: (call) => {
      // retrieve user id from the call object
      const { id = 0 } = call.request;
      // find user in Redis and invoke a callback
      findUser(id, (err, user) => {
        // upon an error (user not found), stop the stream w/ an error
        if (err) return call.end();
        // get the user id from the found user
        const {id: userId = 0} = user
        // bring said user online
        user.status = Status.ONLINE;
        // update that user's profile in Redis
        updateUser(user, console.error);
        // take an array of messages and stream data back to the client
        listMessagesFromMainRoom((msgs) => {
          // store the call object (list of incoming messages by the user id)
          userIdToMsgStream.set(userId, call);
          // stream individual messages from main/broadcasting room back to the client
          for (const msg of msgs) {
            call.write(msg);
          }
        });
        // whenever user's message stream is over, clear the stateful object storing streamed messages from that user
        call.on("cancelled", () => {
        // delete user's stream from broadcasting
          userIdToMsgStream.delete(id)
          user.status = Status.OFFLINE;
          updateUser(user, (err) => {
            if(err) console.error(err);
            emitUserUpdateEvent(user);
          });
        });


      });
    },
    // client adding a message to the broadcasting chat
    SendMessage: (call, callback) => {
      // destructure client/call payload to get user id and the message string
      const { id = 0, message = "" } = call.request;
      // check if no ID was passed in
      if (!id) return callback(new Error("not valid id"));
      // check if no Message was passed in
      if (!message) return callback(new Error("no message"));
      console.log("sendMessage", "frontend message on the server", message)

      // find user from Redis and invoke the following callback
      findUser(id, (err, user) => {
        if (err) return callback(null, err);
        // create a message object using user data and request message string
        const msg: StreamMessage = {
          id,
          senderName: user.name,
          senderAvatar: user.avatar,
          message,
        };
        // add the above message to a chat room
        addChatToMainRoom(msg, (err) => {
          // upon an error, call a callback w/ the error
          if (err) callback(null, err);
          // after adding a message to chat room, emit said message to the chat room
          emitMainRoomChatUpdate(msg);
          callback(null);
        });
      });
    },
    // receive a user ID and stream the list of all users back to the client
    UserStream: (call) => {
      // get incoming user's id
      const { id = 0 } = call.request;
      if (!id) return call.end();
      // find user in Redis by specific id
      findUser(id, (err, user) => {
        // extract user's id
        const {id: userId = 0} = user
        if (err) return call.end();
        // update user's status to ONLINE
        user.status = Status.ONLINE;
        updateUser(user, () => {
          if(err) throw err
          // get the list of all users from Redis
          listUsers((err, users) => {
            if (err) throw err;
            // update the stateful map to pair userID with its call
            userIdToUserListStream.set(userId, call);
            // stream the list of users back to the client
            for (const [, stream] of userIdToUserListStream) {
              // this is just syntax but stream = call
              stream.write({ users });
            }
          });
        });
        // whenever user stream is cancelled, remove it from the list AND update the user to go offline
        call.on("cancelled", () => {
          userIdToUserListStream.delete(id)
          user.status = Status.OFFLINE;
          updateUser(user, (err) => {
            if(err) throw err
            emitUserUpdateEvent(user)
          });
        });
      });
    },
  } as RandomHandlers);

  return server;
}

// listen to Chat updates and User list updates
function runStreams() {
  // add a new message to each of the user's message streams
  listenMainRoomChatUpdate((data, channel) => {
    // parse incoming data as StreamMessage
    const msg = JSON.parse(data) as StreamMessage;
    // publish the newly created message to every user's message stream
    for (const [, stream] of userIdToMsgStream) {
      stream.write(msg);
    }
  });

  // update a list of users for each individual users's stream list
  listenUserUpdateEvent(() =>
  // get a list of all users
    listUsers((err, users) => {
      if (err) throw err;
      // update each user stream with the new list of users
      for (const [, stream] of userIdToUserListStream) {
        stream.write({ users });
      }
    })
  );
}

main();