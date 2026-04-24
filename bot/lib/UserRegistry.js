const User = require('./User');

class UserRegistry {
  static instance = null;
  
  #usersMap = new Map();
  
  #TIME_15_MIN = 1000 * 60 * 15;
  
  constructor() {
    if (!UserRegistry.instance) {
      UserRegistry.instance = this;
    }
    
    return UserRegistry.instance;
  }
  
  getUser(userChatId) {
    const userMap = this.#usersMap;
    
    if (!userMap.has(userChatId)) {
      userMap.set(userChatId, {
        instance: new User(userChatId),
        timeout: null
      });
    }
    
    this.#updateUserTimeout(userChatId);
    
    return userMap.get(userChatId).instance;
  }
  
  #updateUserTimeout(userChatId) {
    const userData = this.#usersMap.get(userChatId);
    
    clearTimeout(userData.timeout);
    userData.timeout = setTimeout(this.#clearUser.bind(this), this.#TIME_15_MIN, userChatId);
  }
  
  #clearUser(userChatId) {
    this.#usersMap.delete(userChatId);
  }
}

module.exports = UserRegistry;
