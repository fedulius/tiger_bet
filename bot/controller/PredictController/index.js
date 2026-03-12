const Controller = require('../Controller');
const request = require('request');

class PredictController extends Controller {

  constructor({pg, lib}) {
    super(lib);
  }

  categoryAction(msg, categoryId) {

  }

  #requestPrediction(msg, categoryId) {
    request.get({
      headers: {'content-type': 'text/html;charset=utf-8'},
      url: '/',
    }, function(error, response, body){
      if (error) {
        console.log(error);
        return 0;
      }
      return body;
    });
  }

}
module.exports = PredictController;