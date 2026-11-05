/* Готовые примеры для быстрого старта. */
(function (global) {
  'use strict';

  const EXAMPLES = [
    {
      id: 'factorial',
      title: 'Факториал (for)',
      code: `#include <iostream>

int main() {
    int n;
    std::cout << "n = ";
    std::cin >> n;

    long long fact = 1;
    for (int i = 2; i <= n; ++i) {
        fact *= i;
    }

    std::cout << "n! = " << fact << std::endl;
    return 0;
}`
    },
    {
      id: 'ifelse',
      title: 'Ветвление и while',
      code: `#include <iostream>
using namespace std;

int main() {
    int x;
    cin >> x;

    if (x < 0) {
        cout << "negative";
    } else if (x == 0) {
        cout << "zero";
    } else {
        cout << "positive";
    }

    while (x > 0) {
        x -= 2;
    }

    return 0;
}`
    },
    {
      id: 'switch',
      title: 'switch / case',
      code: `#include <iostream>

int main() {
    int day;
    std::cin >> day;

    switch (day) {
        case 1:
            std::cout << "Mon";
            break;
        case 2:
            std::cout << "Tue";
            break;
        case 3:
            std::cout << "Wed";
            break;
        default:
            std::cout << "Other";
    }

    return 0;
}`
    },
    {
      id: 'class',
      title: 'Класс и методы',
      code: `#include <iostream>

class Counter {
public:
    Counter(int start) : value(start) {}
    void inc() { ++value; }
    int get() const { return value; }
private:
    int value;
};

int main() {
    Counter c(0);
    for (int i = 0; i < 3; ++i) {
        c.inc();
    }
    std::cout << c.get() << std::endl;
    return 0;
}`
    },
    {
      id: 'sort',
      title: 'Сортировка (do-while)',
      code: `#include <iostream>

int main() {
    int a[5];
    for (int i = 0; i < 5; ++i) {
        std::cin >> a[i];
    }

    bool swapped;
    do {
        swapped = false;
        for (int i = 0; i < 4; ++i) {
            if (a[i] > a[i + 1]) {
                int t = a[i];
                a[i] = a[i + 1];
                a[i + 1] = t;
                swapped = true;
            }
        }
    } while (swapped);

    for (int i = 0; i < 5; ++i) {
        std::cout << a[i] << " ";
    }
    return 0;
}`
    }
  ];

  global.CPP_EXAMPLES = EXAMPLES;
})(window);
