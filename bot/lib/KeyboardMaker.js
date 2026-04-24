class KeyboardMaker {
  
  static instance = null;
  
  constructor() {
    if (KeyboardMaker.instance) {
      return KeyboardMaker.instance;
    }
    return KeyboardMaker.instance = this;
  }
  
  generateKeyboard(keyboardData = [], maxInLine = 2) {
    let keyboard = [];
    let object = keyboardData.map(([text, callback]) => this.#createObject(text, callback));

    for (let a = 0, len = Math.floor(object.length / maxInLine); a < len; a++) {
      if (maxInLine === 2) {
        keyboard.push([object.shift(), object.shift()]);
      } else {
        keyboard.push([object.shift()]);
      }
    }
    
    if (object.length) {
      keyboard.push([object.shift()]);
    }

    return keyboard;
    
  }

  generateCustomKeyboard(keyboardData = [], inlineListAmount = []) {
    let keyboard = [];
    let temporallyArray = [];
    let object = keyboardData.map(([text, callback]) => this.#createObject(text, callback));

    // for(let i = 0, len = Math.floor(object.length / inlineListAmount[0]); i < len; i++) {
    //   if (i < inlineListAmount[0]) {
    //     temporallyArray.push(object.shift());
    //   } else {
    //     temporallyArray.push(object.shift());
    //     inlineListAmount.shift();
    //     keyboard.push(temporallyArray);
    //     temporallyArray = [];
    //   }
    // }

    for (let i = 0; inlineListAmount.length > i; i++) {
      for (let j = 0; inlineListAmount[i] > j; j++) {
        temporallyArray.push(object.shift());
      }
      keyboard.push(temporallyArray);
      temporallyArray = [];
    }

    return keyboard;
  }
  
  #createObject(text, callback) {
    return {text: text, callback_data: callback};
  }
}

module.exports = KeyboardMaker;