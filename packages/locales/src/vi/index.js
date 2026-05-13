import merge from 'lodash/merge';

import error from './error';
import login from './login';

export default {
  language: 'vi',
  country: 'vn',
  name: 'Tiếng Việt',
  embeddedLocale: merge(error, login),
  flags: ['VN'],
};
