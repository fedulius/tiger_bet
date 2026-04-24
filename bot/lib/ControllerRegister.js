class ControllerRegister {
  static instance = null;
  #controllers = new Map();
  
  constructor(pg) {
    this.pg = pg;
    if (ControllerRegister.instance) {
      return ControllerRegister.instance;
    }
    ControllerRegister.instance = this;
  }
  
  getController(controllerName) {
    controllerName = controllerName.toLowerCase();
    controllerName = controllerName.charAt(0).toUpperCase() + controllerName.slice(1);

    if (!this.#controllers.has(controllerName)) {
      this.#controllers.set(controllerName, new (require(`../controller/${controllerName}Controller`))({pg: this.pg, lib: require('./index')}));
    }

    return this.#controllers.get(controllerName);
  }
  
}

module.exports = ControllerRegister;