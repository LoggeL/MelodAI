"""Small, shared request validators that preserve the API's error envelope."""

from flask import request
from werkzeug.exceptions import BadRequest


def json_object(*, optional=False):
    if optional and not request.get_data():
        return {}
    if not request.is_json:
        raise BadRequest("Request body must be a JSON object")
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise BadRequest("Request body must be a JSON object")
    return data


def text_field(data, name, default="", *, strip=True, max_length=1000):
    value = data.get(name, default)
    if not isinstance(value, str):
        raise BadRequest(f"{name} must be a string")
    if len(value) > max_length:
        raise BadRequest(f"{name} must be at most {max_length} characters")
    return value.strip() if strip else value


def integer_field(data, name, default=None, *, minimum=0, maximum=2147483647):
    value = data.get(name, default)
    if type(value) is not int or not minimum <= value <= maximum:
        raise BadRequest(f"{name} must be an integer between {minimum} and {maximum}")
    return value


def boolean_field(data, name, default=False):
    value = data.get(name, default)
    if type(value) is not bool:
        raise BadRequest(f"{name} must be a boolean")
    return value
