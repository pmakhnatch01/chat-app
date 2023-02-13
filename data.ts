  import redis from "redis";
  // N - node, R - redis, P - pubsub
  import NRP from "node-redis-pubsub";
  import { StreamMessage } from "./proto/randomPackage/StreamMessage";
  import { User } from "./proto/randomPackage/User";

  const REDIST_KEYS = {
    broadcastRoom: "room:0:messages",
    users: "users",
  };

const client = redis.createClient();

client.on("error", console.error);
client.on("connect", console.log);
// error Callback type
type errCB = (err: Error | null) => void;
// reply Callback type
type replyCB<T> = (err: Error | null, reply: T) => void;

// retrieve messages from the broadcasting room and invoke an argument callback on the array of said messages
export const listMessagesFromMainRoom = (
  // declare the types of callback
  done?: (data: Array<StreamMessage>) => void
) => {
  // find all the messages in the broadcasting room 
  client.lrange(REDIST_KEYS.broadcastRoom, 0, -1, (err, reply) => {
    // put the messages to an array of correct type
    const msgs: Array<StreamMessage> = [];
    for (const res of reply) {
      msgs.push(JSON.parse(res));
    }
    // invoke callback on the array of broadcasting messages
    done && done(msgs);
  });
};


// takes a message and adds it to the broadcastRoom in Redis
export const addChatToMainRoom = (msg: StreamMessage, fn: errCB) => {
  client.rpush(REDIST_KEYS.broadcastRoom, JSON.stringify(msg), fn);
};

// add a user to Redis DB
export const addUser = (user: User, fn: errCB) => {
  client.rpush(REDIST_KEYS.users, JSON.stringify(user), fn);
};

// return a list of all users in an array and invoke a callback on that array
export const listUsers = (fn: replyCB<User[]>) => {
  // get users array from Redis DB ~ reply
  client.lrange(REDIST_KEYS.users, 0, -1, (err, reply) => {
    if (err) return fn(err, []);
    // put all the user's data w/ correct types in the array
    const users: Array<User> = [];
    for (const r of reply) {
      users.push(JSON.parse(r));
    }
    // invoke the passed in callback on the users array
    fn(null, users);
  });
};

// find user in Redis by their ID and invoke a callback on said user
export const findUser = (userId: number, fn: replyCB<User>) => {
  // takes error and an array of useres as an argument
  listUsers((err, users) => {
    if(err) return fn(err, {} as User)
    // find index of the given user
    const i = users.findIndex((e) => e.id === userId)
    // invoke callback on the given user's profile
    fn(null, users[i])
  })
}


// update user's bio
export const updateUser = (user: User, fn: errCB) => {
  listUsers((err, users) => {
    if(err) return fn(err)
    // find index of passed in user in the users array
    const i = users.findIndex((e) => e.id === user.id)
    // if no user is found, return an error
    if(i === -1) return fn(Error('cannot find user'))
    // update that user's bio with the passed in info
    client.lset(REDIST_KEYS.users, i, JSON.stringify(user), fn)
  })
}

// export Redis client
export default client;
// export Redis publisher = emitter and subscriber = receiver clients
export const nrp = NRP({
  // emitter is a Redis client that will be used to publish messages to channels
  emitter: redis.createClient(),
  // receiver is a Redis client that will be used to subscribe to channels and receive messages
  receiver: redis.createClient(),
});