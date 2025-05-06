export const getPagination = (page: number, limit: number) => {
    const offset = (page - 1) * limit;
    return { limit, offset };
  };