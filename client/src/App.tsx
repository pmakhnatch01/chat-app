import React, { useEffect, useState } from "react";
import "./App.css";
import { RandomClient } from "./proto/RandomServiceClientPb";
import {
  StreamRequest,
  InitiateRequest,
  StreamMessage,
  UserStreamResponse,
  User,
  MessageRequest,
} from "./proto/random_pb";
import Greeting from "./components/Greeting";
import Chat from "./components/Chat";

// keep a client outside of the app so it doesn't get re-created on re-render
export const client = new RandomClient("http://localhost:8080");

// user type
export type Session = { id: number; name: string; avatar: string };

function App() {

  // current user
  const [user, setUser] = useState<Session>();
  // instead of StreamMessage, on the client side it is StreamMessage.AsObject but it they are the same thing
  // frontend list of messages and users
  const [messages, setMessages] = useState<Array<StreamMessage.AsObject>>([]);
  const [userList, setUserList] = useState<Array<User.AsObject>>([]);

  // whenever a new user enters a chat on the Greeting screen
  const handleEnterChat = (name: string, avatar: string) => {
    // create a request from proto, add data
    const intiateReq = new InitiateRequest();
    intiateReq.setName(name);
    intiateReq.setAvatarUrl(avatar);
    // send new user joining chat request to the server
    client.chatInitiate(intiateReq, {}, (err, resp) => {
      if (err) throw err;
      // get user ID from the server
      const id = resp.getId();
      // store user's id, name, avatar in frontend state
      setUser({ id, name, avatar });
    });
  };

  // enter a new message to the chat
  const handleSendMessage = (msg: string, onSuccess: () => void) => {
    console.log(user, !user);
    if (!user) return;
    // create a new message request from proto
    const req = new MessageRequest();
    req.setId(user.id);
    req.setMessage(msg);
    console.log("here we go");
    console.log("req", req)
    // broadcast the message
    client.sendMessage(req, {}, (err, resp) => {
      if (err) throw err;
      // invoke the callback
      onSuccess();
    });
  };

  // run this whenever the current user changes
  useEffect(() => {
    // if user is undefined, don't run anything
    if (!user) return;

    // stream messages from server back to the client ~ bring the user online
    const chatReq = new StreamRequest();
    (() => {
      // set id parameter of a request to the current user's id
      chatReq.setId(user.id);
      // initialize the stream of chat messages from the server
      const chatStream = client.chatStream(chatReq);
      chatStream.on("data", (chunk) => {
        const msg = (chunk as StreamMessage).toObject();
        console.log(msg);
        // for every new chat message, update the frontend message list
        setMessages((prev) => [...prev, msg]);
      });
    })();

    // stream users list from server back to the client ~ bring the user online
    (() => {
      // get a users list stream
      const userListStream = client.userStream(chatReq);
      userListStream.on("data", (chunk) => {

        const { usersList } = (chunk as UserStreamResponse).toObject();
        console.log(usersList);
        setUserList(usersList);
      });
    })();
  }, [user]);

  // if there's a current user, display Chat component for that specific user POV
  // otherwise, display Greeting component
  return (
    <div className="App">
      {user ? (
        <Chat
          user={user}
          userList={userList}
          messages={messages}
          onMessageSubmit={handleSendMessage}
        />
      ) : (
        <Greeting onUsernameEnter={handleEnterChat} />
      )}
    </div>
  );
}

export default App;
