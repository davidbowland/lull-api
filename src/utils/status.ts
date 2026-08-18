export default {
  OK: { statusCode: 200 },
  CREATED: { statusCode: 201 },
  ACCEPTED: { statusCode: 202 },
  NO_CONTENT: { statusCode: 204, body: '' },
  BAD_REQUEST: { statusCode: 400, body: '{"message":"Bad request"}' },
  FORBIDDEN: { statusCode: 403 },
  NOT_FOUND: { statusCode: 404, body: '{"message":"Not found"}' },
  INTERNAL_SERVER_ERROR: { statusCode: 500, body: '{"message":"Internal server error"}' },
}
