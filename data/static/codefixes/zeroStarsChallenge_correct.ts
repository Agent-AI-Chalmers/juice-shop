rating: {
  type: DataTypes.INTEGER,
  allowNull: false,
  validate: {
    isInt: true,
    min: 1,
    max: 5
  },
  set (value: unknown) {
    const rating = Number(value)
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new Error('Invalid rating')
    }
    this.setDataValue('rating', rating)
  }
}