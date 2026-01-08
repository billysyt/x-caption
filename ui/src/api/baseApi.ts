import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";

const rawBaseQuery = fetchBaseQuery({
  baseUrl: "",
  credentials: "same-origin"
});

export const api = createApi({
  reducerPath: "api",
  baseQuery: rawBaseQuery,
  endpoints: () => ({})
});
