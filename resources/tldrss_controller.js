var app = angular.module('tldrss_controller', []);
app.controller('tldrssCtrl', function($scope, $http) {
	$scope.createFeed = function(host, rule) {
		$http.post('/create-feed', {host: $scope.inputHost, rule: $scope.inputRule})
		.success(function(response) {
				// Called asynchronously when the response is available
				$scope.resHost = response.host;
				$scope.resRule = response.rule;
				$scope.resFeedID = response.feedID;
				$scope.inputHostIsInvalid = response.inputHostIsInvalid;
				if($scope.inputHostIsInvalid) {
					// An error message with invalidHost appears
					$scope.invalidHost = resHost;
				}
				else {
					// Add an entry in createdFeeds. The DOM will
					// auto-update with a success message box
					$scope.createdFeeds.push({host: $scope.resHost, rule: $scope.resRule, feedID: $scope.resFeedID});
				}
				// Reset inputs
				$scope.inputHost = '';
				$scope.inputRule = 2;
			});
	};
	/*	Remove a "new feed" dialogue by removing its
	 *	entry from the createdFeeds array. The DOM
	 *	element will automatically be removed.
	 */
	$scope.dismissNewFeedDialogue = function(index) {
		delete $scope.createdFeeds[index];
		$scope.apply();
	}
});