class InlineController {

  constructor() {
  }

  main(categoryList) {
    let content = [];
    categoryList.forEach((category) => {
      content.push([category.category_name, `predict_category_${category.prediction_category_id}`]);
    });

    return content;
  }
}

module.exports = InlineController;