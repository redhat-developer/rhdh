# Licensed User Info Plugin Documentation

This plugin provides statistical information about logged-in users.

# Available Endpoints

The plugin exposes the following endpoints to retrieve data about recorded logged-in users:

1. Retrieve the number of logged-In users
   use `/users/quantity` endpoint to get the total count of recorded logged-in users:

```bash
curl -X GET "http://localhost:7007/api/licensed-users-info/users/quantity" -H "Content-Type: application/json" -H "Authorization: Bearer $token"
```

Example output:

```json
{ "quantity": "2" }
```

2. Retrieve the list of logged-In users
   use `/users` endpoint to get a list of recorded logged-in users:

```bash
curl -X GET "http://localhost:7007/api/licensed-users-info/users" -H "Content-Type: application/json" -H "Authorization: Bearer $token"
```

Example output:

```json
[
  {
    "userEntityRef": "user:default/dev",
    "lastTimeLogin": "Thu, 22 Aug 2024 16:27:41 GMT",
    "displayName": "John Leavy",
    "email": "dev@redhat.com"
  },
  {
    "userEntityRef": "user:default/test-bit",
    "lastTimeLogin": "Thu, 22 Aug 2024 16:35:28 GMT",
    "email": "test-bit@gmail.com"
  }
]
```

Retrieve the list of users in CSV format `/users` endpoint also supports returning the list of users in CSV format by setting the Content-Type header to text/csv:

```bash
curl -X GET "http://localhost:7007/api/licensed-users-info/users" -H "Content-Type: text/csv" -H "Authorization: Bearer $token"
```

```text
Example output:

userEntityRef,displayName,email,lastTimeLogin
user:default/dev,John Leavy,dev@redhat.com,"Thu, 22 Aug 2024 16:27:41 GMT"
user:default/test-bit,undefined,test-bit@gmail.com,"Thu, 22 Aug 2024 16:35:28 GMT"
```

> Notice: this plugin can not provide information about logged in users before update showcase to backstage 1.29.2. It relies on features introduced in the backstage-plugin-auth-backend starting from version 1.28.0
