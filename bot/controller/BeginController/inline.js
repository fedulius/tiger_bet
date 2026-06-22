class InlineController {

  constructor() {
  }

  main(categoryList) {
    let content = [];
    categoryList.forEach((category) => {
      content.push([category.sport_name, `league_category_${category.sport_id}`]);
    });

    return content;
  }
}

module.exports = InlineController;